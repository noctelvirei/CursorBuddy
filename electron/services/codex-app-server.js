const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { EventEmitter } = require("events");
const log = require("../lib/session-logger.js");

const CODEX_SYSTEM_PROMPT = `you are cursorbuddy, a friendly always-on companion that helps the user understand what is on their screen and what to do next.

rules:
- default to one or two sentences. be direct and dense. if the user asks for more detail, go deeper.
- all lowercase, casual, warm. no emojis.
- write for the ear, not the eye. no markdown, no bullet points, no lists.
- reference specific things visible in the screenshots when they matter.
- if the user attached a screenshot manually, prioritise it over automatic captures.
- don't claim you clicked, typed, opened, or changed anything. you are in read-only guidance mode.
- don't tell the user you are read-only unless that limitation is directly relevant.

element pointing:
- when pointing would help, append a coordinate tag at the very end of your reply.
- coordinates must use the screenshot pixel space from the labeled screenshots.
- format: [POINT:x,y:label]
- if the target is on another screen, use [POINT:x,y:label:screenN]
- if pointing would not help, append [POINT:none].`;

function buildPointFallbackPrompt(userQuestion, assistantResponse) {
  const context = assistantResponse
    ? `the user asked: "${userQuestion}"\n\nyour main reply was: "${assistantResponse.slice(0, 500)}"\n\nbased on that reply, identify the single most relevant on-screen element to point at.`
    : `the user asked: "${userQuestion}"\n\nidentify the single most relevant on-screen element to point at.`;

  return `you are only doing point selection for cursorbuddy.

${context}

rules:
- output exactly one point tag and nothing else
- use screenshot pixel coordinates from the provided image label
- format must be [POINT:x,y:label]
- if there is no clear element to point at, output [POINT:none]
- do not call tools
- do not explain your reasoning`;
}

class CodexAppServerClient extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.readline = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.threadId = null;
    this.instructionsInjected = false;
    this.authState = {
      authMode: null,
      accountType: null,
      email: null,
      planType: null,
      isAuthenticated: false,
      requiresOpenaiAuth: true,
      error: null,
    };
    this.activeTurn = null;
  }

  getExecutableCandidates() {
    const candidates = [];
    const userProfile = process.env.USERPROFILE || os.homedir();
    const localAppData = process.env.LOCALAPPDATA || (userProfile ? path.join(userProfile, "AppData", "Local") : null);
    const homeDir = os.homedir();
    const exeName = process.platform === "win32" ? "codex.exe" : "codex";

    if (process.env.CURSORBUDDY_CODEX_PATH) {
      candidates.push(process.env.CURSORBUDDY_CODEX_PATH);
    }
    if (process.env.CODEX_PATH) {
      candidates.push(process.env.CODEX_PATH);
    }
    if (userProfile) {
      candidates.push(path.join(userProfile, ".codex", ".sandbox-bin", exeName));
    }
    if (localAppData) {
      candidates.push(path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe"));
      candidates.push(path.join(localAppData, "Microsoft", "WindowsApps", "codex.exe"));
    }
    if (homeDir && homeDir !== userProfile) {
      candidates.push(path.join(homeDir, ".codex", ".sandbox-bin", exeName));
    }

    return candidates;
  }

  getSpawnSpecs() {
    const seen = new Set();
    const specs = [];

    const pushSpec = (command, args) => {
      const key = `${command}::${JSON.stringify(args)}`;
      if (seen.has(key)) return;
      seen.add(key);
      specs.push({ command, args });
    };

    pushSpec("codex", ["app-server"]);

    for (const candidate of this.getExecutableCandidates()) {
      try {
        if (candidate && fs.existsSync(candidate)) {
          pushSpec(candidate, ["app-server"]);
        }
      } catch (_) {}
    }

    if (process.platform === "win32") {
      pushSpec("cmd.exe", ["/d", "/s", "/c", "codex app-server"]);
    }

    return specs;
  }

  getCLIProbeSpecs() {
    const seen = new Set();
    const specs = [];

    const pushSpec = (command, args, source) => {
      const key = `${command}::${JSON.stringify(args)}`;
      if (seen.has(key)) return;
      seen.add(key);
      specs.push({ command, args, source });
    };

    pushSpec("codex", ["--version"], "path");

    for (const candidate of this.getExecutableCandidates()) {
      try {
        if (candidate && fs.existsSync(candidate)) {
          pushSpec(candidate, ["--version"], "fallback");
        }
      } catch (_) {}
    }

    if (process.platform === "win32") {
      pushSpec("cmd.exe", ["/d", "/s", "/c", "codex --version"], "path");
    }

    return specs;
  }

  async probeCLI() {
    const { execFile } = require("child_process");

    for (const spec of this.getCLIProbeSpecs()) {
      const result = await new Promise((resolve) => {
        execFile(spec.command, spec.args, { timeout: 5000, windowsHide: true }, (error, stdout, stderr) => {
          if (error) {
            resolve(null);
            return;
          }
          const text = (stdout || stderr || "").trim().split(/\r?\n/)[0] || null;
          resolve({
            found: true,
            path: spec.command,
            version: text,
            source: spec.source,
          });
        });
      });

      if (result) return result;
    }

    return { found: false, path: null, version: null, source: null };
  }

  async startProcess(command, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      let settled = false;
      const onExit = (code, signal) => {
        const err = new Error(`Codex app-server exited (${code ?? "null"}${signal ? `, ${signal}` : ""})`);
        if (settled) {
          this.handleProcessExit(err);
          return;
        }
        failStart(err);
      };
      const failStart = (err) => {
        if (settled) return;
        settled = true;
        try { proc.kill(); } catch (_) {}
        reject(err);
      };

      proc.once("error", failStart);
      proc.once("exit", onExit);

      proc.stderr.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text) log.event("codex:stderr", { text: text.slice(0, 500), command });
      });

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on("line", (line) => this.handleLine(line));

      this.proc = proc;
      this.readline = rl;

      this.requestInternal("initialize", {
        clientInfo: {
          name: "cursorbuddy",
          title: "CursorBuddy",
          version: "0.1.0",
        },
      }).then(() => {
        if (settled) return;
        settled = true;
        this.notify("initialized", {});
        resolve();
      }).catch((err) => {
        failStart(err);
      });
    });
  }

  async ensureStarted() {
    if (this.proc && !this.proc.killed) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise((resolve, reject) => {
      (async () => {
        const errors = [];

        for (const { command, args } of this.getSpawnSpecs()) {
          try {
            await this.startProcess(command, args);
            this.startPromise = null;
            resolve();
            return;
          } catch (err) {
            errors.push(`${command}: ${err.message}`);
            this.proc = null;
            this.readline = null;
            this.pending.clear();
          }
        }

        const combined = new Error(
          `Unable to launch Codex app-server. Tried: ${errors.join(" | ")}`
        );
        this.authState = { ...this.authState, error: combined.message };
        this.emit("auth-state", this.authState);
        this.startPromise = null;
        reject(combined);
      })().catch((err) => {
        this.authState = { ...this.authState, error: err.message };
        this.emit("auth-state", this.authState);
        this.startPromise = null;
        reject(err);
      });
    });

    return this.startPromise;
  }

  handleProcessExit(err) {
    for (const { reject } of this.pending.values()) {
      reject(err);
    }
    this.pending.clear();

    if (this.activeTurn) {
      this.activeTurn.cleanup?.();
      this.activeTurn = null;
    }

    this.proc = null;
    this.readline = null;
    this.threadId = null;
    this.instructionsInjected = false;
    this.startPromise = null;
    this.authState = {
      ...this.authState,
      authMode: null,
      accountType: null,
      email: null,
      planType: null,
      isAuthenticated: false,
      error: err?.message || "Codex app-server stopped",
    };
    this.emit("auth-state", this.authState);
  }

  handleLine(line) {
    if (!line?.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      log.event("codex:parse_error", { line: line.slice(0, 500), error: err.message });
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "Codex app-server request failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    this.handleNotification(message.method, message.params || {});
  }

  handleNotification(method, params) {
    switch (method) {
      case "account/updated": {
        const authMode = params.authMode || null;
        this.authState = {
          ...this.authState,
          authMode,
          isAuthenticated: authMode === "chatgpt",
          error: null,
        };
        this.emit("auth-state", this.authState);
        if (authMode === "chatgpt" || authMode === null) {
          this.refreshAuthState().catch(() => {});
        }
        break;
      }
      case "account/login/completed": {
        this.emit("login-completed", params);
        if (params.success) {
          this.refreshAuthState().catch(() => {});
        }
        break;
      }
      case "thread/closed": {
        if (params.threadId && params.threadId === this.threadId) {
          this.threadId = null;
          this.instructionsInjected = false;
        }
        break;
      }
      case "thread/status/changed": {
        if (params.threadId && params.threadId === this.threadId && params.status?.type === "notLoaded") {
          this.threadId = null;
          this.instructionsInjected = false;
        }
        break;
      }
      case "item/agentMessage/delta": {
        if (!this.activeTurn) break;
        const delta = typeof params.delta === "string"
          ? params.delta
          : typeof params.textDelta === "string"
            ? params.textDelta
            : "";
        if (!delta) break;
        this.activeTurn.fullText += delta;
        this.activeTurn.onChunk({ type: "text", text: this.activeTurn.fullText });
        break;
      }
      case "item/completed": {
        if (!this.activeTurn) break;
        const item = params.item || {};
        if (item.type === "agentMessage" && typeof item.text === "string" && item.text.length >= this.activeTurn.fullText.length) {
          this.activeTurn.fullText = item.text;
          this.activeTurn.onChunk({ type: "text", text: this.activeTurn.fullText });
        }
        break;
      }
      case "turn/completed": {
        if (!this.activeTurn) break;
        const turn = params.turn || {};
        if (this.activeTurn.turnId && turn.id && turn.id !== this.activeTurn.turnId) break;

        const { resolve, reject, fullText, cleanup, onChunk } = this.activeTurn;
        this.activeTurn = null;
        cleanup?.();

        if (turn.status === "failed") {
          reject(new Error(turn.error?.message || "Codex turn failed"));
          return;
        }
        if (turn.status === "interrupted") {
          reject(new Error("Codex turn interrupted"));
          return;
        }
        onChunk({ type: "done" });
        resolve(fullText);
        break;
      }
      case "error": {
        if (!this.activeTurn) break;
        const err = new Error(params.error?.message || "Codex app-server error");
        const { reject, cleanup } = this.activeTurn;
        this.activeTurn = null;
        cleanup?.();
        reject(err);
        break;
      }
      default:
        break;
    }
  }

  send(message) {
    if (!this.proc?.stdin) {
      throw new Error("Codex app-server is not running");
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) {
    this.send({ method, params });
  }

  async request(method, params) {
    await this.ensureStarted();

    return this.requestInternal(method, params);
  }

  requestInternal(method, params) {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ method, id, params });
    });
  }

  async refreshAuthState() {
    try {
      const result = await this.request("account/read", { refreshToken: false });
      const account = result?.account || null;
      const accountType = account?.type || null;
      const authMode = accountType === "apiKey" ? "apikey" : accountType;
      this.authState = {
        authMode,
        accountType,
        email: account?.email || null,
        planType: account?.planType || null,
        isAuthenticated: accountType === "chatgpt",
        requiresOpenaiAuth: result?.requiresOpenaiAuth !== false,
        error: null,
      };
    } catch (err) {
      this.authState = {
        ...this.authState,
        isAuthenticated: false,
        error: err.message,
      };
    }
    this.emit("auth-state", this.authState);
    return this.authState;
  }

  async loginWithChatGPT() {
    const result = await this.request("account/login/start", { type: "chatgpt" });
    return {
      loginId: result?.loginId || null,
      authUrl: result?.authUrl || null,
    };
  }

  async logout() {
    await this.request("account/logout", {});
    await this.clearThread();
    return this.refreshAuthState();
  }

  async clearThread() {
    if (!this.threadId) {
      this.instructionsInjected = false;
      return;
    }
    try {
      await this.request("thread/unsubscribe", { threadId: this.threadId });
    } catch (_) {}
    this.threadId = null;
    this.instructionsInjected = false;
  }

  getEffort(settings) {
    if (!settings?.chatReasoningEnabled) return undefined;
    const budget = settings.chatReasoningBudget || 4096;
    if (budget <= 1024) return "low";
    if (budget <= 8192) return "medium";
    return "high";
  }

  async ensureThread({ model, cwd, effort }) {
    if (this.threadId) return this.threadId;

    const result = await this.request("thread/start", {
      model: model || "gpt-5.4",
      cwd: cwd || process.cwd(),
      approvalPolicy: "never",
      sandbox: "read-only",
      personality: "friendly",
      effort,
      serviceName: "cursorbuddy",
    });

    this.threadId = result?.thread?.id || null;
    this.instructionsInjected = false;
    if (!this.threadId) {
      throw new Error("Codex app-server did not return a thread id");
    }
    return this.threadId;
  }

  createScreenshotFiles(screens) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursorbuddy-codex-"));
    const files = [];

    screens.forEach((screen, index) => {
      const filename = path.join(tempDir, `screen-${index + 1}.jpg`);
      fs.writeFileSync(filename, Buffer.from(screen.imageDataBase64, "base64"));
      files.push({ path: filename, label: screen.label });
    });

    return {
      files,
      cleanup: () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
      },
    };
  }

  async runTurnWithInput({
    threadId,
    input,
    model,
    effort,
    onChunk = () => {},
    cleanup = () => {},
    summary = "concise",
  }) {
    if (this.activeTurn) {
      throw new Error("Codex is already handling another request");
    }

    return new Promise(async (resolve, reject) => {
      try {
        this.activeTurn = {
          turnId: null,
          fullText: "",
          onChunk,
          resolve,
          reject,
          cleanup,
        };

        const result = await this.request("turn/start", {
          threadId,
          input,
          model: model || "gpt-5.4",
          cwd: process.cwd(),
          approvalPolicy: "never",
          sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
          effort,
          personality: "friendly",
          summary,
        });

        this.activeTurn.turnId = result?.turn?.id || null;
      } catch (err) {
        cleanup();
        this.activeTurn = null;
        reject(err);
      }
    });
  }

  async runTurn({ transcript, screens, settings, onChunk }) {
    const authState = await this.refreshAuthState();
    if (!authState.isAuthenticated) {
      throw new Error("Codex is not signed in. Use Sign in with ChatGPT in the panel.");
    }

    const effort = this.getEffort(settings);
    const threadId = await this.ensureThread({
      model: settings?.chatModel || "gpt-5.4",
      cwd: process.cwd(),
      effort,
    });

    const { files, cleanup } = this.createScreenshotFiles(screens || []);
    const input = [];

    if (!this.instructionsInjected) {
      input.push({ type: "text", text: CODEX_SYSTEM_PROMPT });
      this.instructionsInjected = true;
    }

    for (const file of files) {
      input.push({ type: "localImage", path: file.path });
      input.push({ type: "text", text: file.label });
    }

    input.push({ type: "text", text: transcript });

    return this.runTurnWithInput({
      threadId,
      input,
      model: settings?.chatModel || "gpt-5.4",
      effort,
      onChunk,
      cleanup,
      summary: "concise",
    });
  }

  async runPointFallback({ userQuestion, assistantResponse, screenCapture, settings }) {
    const authState = await this.refreshAuthState();
    if (!authState.isAuthenticated) {
      throw new Error("Codex is not signed in. Use Sign in with ChatGPT in the panel.");
    }

    const effort = this.getEffort(settings);
    const threadResult = await this.request("thread/start", {
      model: settings?.cuModel || settings?.chatModel || "gpt-5.4",
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandbox: "read-only",
      personality: "friendly",
      serviceName: "cursorbuddy",
      ephemeral: true,
    });
    const threadId = threadResult?.thread?.id || null;
    if (!threadId) {
      throw new Error("Codex point fallback could not start a thread");
    }

    const { files, cleanup } = this.createScreenshotFiles(screenCapture ? [screenCapture] : []);
    const input = [{ type: "text", text: buildPointFallbackPrompt(userQuestion, assistantResponse) }];

    for (const file of files) {
      input.push({ type: "localImage", path: file.path });
      input.push({ type: "text", text: file.label });
    }

    try {
      return await this.runTurnWithInput({
        threadId,
        input,
        model: settings?.cuModel || settings?.chatModel || "gpt-5.4",
        effort,
        cleanup,
        summary: "none",
      });
    } finally {
      try {
        await this.request("thread/unsubscribe", { threadId });
      } catch (_) {}
    }
  }
}

module.exports = new CodexAppServerClient();
