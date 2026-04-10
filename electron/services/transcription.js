/**
 * Transcription Service
 *
 * Speech-to-text via AssemblyAI, Deepgram, OpenAI Whisper, or local Faster Whisper.
 * Runs in the Electron main process. Receives PCM16 audio from the
 * renderer via IPC, streams to the provider's WebSocket, returns
 * transcript updates.
 *
 * Apple Speech is handled in the renderer via webkitSpeechRecognition.
 */

const WebSocket = require("ws");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let activeSession = null;

// ── AssemblyAI ────────────────────────────────────────────

class AssemblyAISession {
  constructor(apiKey, onTranscript, onFinal, onError) {
    this.apiKey = apiKey;
    this.onTranscript = onTranscript;
    this.onFinal = onFinal;
    this.onError = onError;
    this.ws = null;
    this.fullText = "";
    this.turns = {};
    this.activeTurnText = "";
  }

  async start() {
    const url = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&format_turns=true&speech_model=u3-rt-pro`;
    this.ws = new WebSocket(url, { headers: { Authorization: this.apiKey } });

    return new Promise((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => { this.onError(err); reject(err); });
      this.ws.on("close", () => {});
      this.ws.on("message", (data) => this._handleMessage(data.toString()));
    });
  }

  sendAudio(pcm16Buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm16Buffer);
    }
  }

  requestFinal() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "ForceEndpoint" }));
    }
  }

  stop() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "Terminate" }));
    }
    this.ws?.close();
    this.ws = null;
  }

  _handleMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "turn") {
        const text = (msg.transcript || "").trim();
        const turnOrder = msg.turn_order ?? 0;
        if (msg.end_of_turn || msg.turn_is_formatted) {
          if (text) this.turns[turnOrder] = text;
          this.activeTurnText = "";
        } else {
          this.activeTurnText = text;
        }
        this.fullText = this._compose();
        if (this.fullText) this.onTranscript(this.fullText);
        if (msg.end_of_turn || msg.turn_is_formatted) {
          this.onFinal(this.fullText);
        }
      } else if (msg.type === "error") {
        this.onError(new Error(msg.error || msg.message || "AssemblyAI error"));
      }
    } catch (_) {}
  }

  _compose() {
    const parts = Object.keys(this.turns).sort((a, b) => a - b).map(k => this.turns[k]);
    if (this.activeTurnText) parts.push(this.activeTurnText);
    return parts.join(" ");
  }
}

// ── Deepgram ──────────────────────────────────────────────

class DeepgramSession {
  constructor(apiKey, onTranscript, onFinal, onError) {
    this.apiKey = apiKey;
    this.onTranscript = onTranscript;
    this.onFinal = onFinal;
    this.onError = onError;
    this.ws = null;
    this.fullText = "";
  }

  async start() {
    const url = `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&punctuate=true&interim_results=true&vad_events=true`;
    this.ws = new WebSocket(url, { headers: { Authorization: `Token ${this.apiKey}` } });

    return new Promise((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => { this.onError(err); reject(err); });
      this.ws.on("message", (data) => this._handleMessage(data.toString()));
    });
  }

  sendAudio(pcm16Buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm16Buffer);
    }
  }

  requestFinal() {
    // Deepgram: send close frame to trigger final transcript
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
    }
  }

  stop() {
    this.ws?.close();
    this.ws = null;
  }

  _handleMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "Results") {
        const alt = msg.channel?.alternatives?.[0];
        if (alt?.transcript) {
          if (msg.is_final) {
            this.fullText += (this.fullText ? " " : "") + alt.transcript;
            this.onFinal(this.fullText);
          }
          this.onTranscript(this.fullText + (msg.is_final ? "" : " " + alt.transcript));
        }
      }
    } catch (_) {}
  }
}

// ── OpenAI Whisper (upload-based, not streaming) ──────────

class OpenAIWhisperSession {
  constructor(apiKey, onTranscript, onFinal, onError) {
    this.apiKey = apiKey;
    this.onTranscript = onTranscript;
    this.onFinal = onFinal;
    this.onError = onError;
    this.audioChunks = [];
  }

  async start() {
    this.audioChunks = [];
  }

  sendAudio(pcm16Buffer) {
    this.audioChunks.push(Buffer.from(pcm16Buffer));
  }

  async requestFinal() {
    if (this.audioChunks.length === 0) return;

    const pcmData = Buffer.concat(this.audioChunks);
    this.audioChunks = [];

    // Build WAV header + PCM data
    const wavBuffer = buildWAV(pcmData, 16000, 1, 16);

    try {
      const boundary = "----CursorBuddy" + Date.now();
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngpt-4o-transcribe\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
        wavBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!res.ok) throw new Error(`Whisper HTTP ${res.status}`);
      const data = await res.json();
      const text = data.text || "";
      this.onTranscript(text);
      this.onFinal(text);
      return text;
    } catch (err) {
      this.onError(err);
      throw err;
    }
  }

  stop() {
    this.audioChunks = [];
  }
}

// ── Local Faster Whisper (upload-style, offline) ──────────

class LocalFasterWhisperSession {
  constructor(settings, onTranscript, onFinal, onError) {
    this.settings = settings || {};
    this.onTranscript = onTranscript;
    this.onFinal = onFinal;
    this.onError = onError;
    this.audioChunks = [];
  }

  async start() {
    this.audioChunks = [];
  }

  sendAudio(pcm16Buffer) {
    this.audioChunks.push(Buffer.from(pcm16Buffer));
  }

  async requestFinal() {
    if (this.audioChunks.length === 0) return;

    const pcmData = Buffer.concat(this.audioChunks);
    this.audioChunks = [];
    const wavBuffer = buildWAV(pcmData, 16000, 1, 16);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursorbuddy-whisper-"));
    const wavPath = path.join(tempDir, "audio.wav");
    fs.writeFileSync(wavPath, wavBuffer);

    try {
      const text = await runFasterWhisper(wavPath, this.settings);
      this.onTranscript(text);
      this.onFinal(text);
      return text;
    } catch (err) {
      this.onError(err);
      throw err;
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  stop() {
    this.audioChunks = [];
  }
}

function runFasterWhisper(wavPath, settings) {
  const python = settings.localWhisperPython || "python";
  const scriptPath = path.join(__dirname, "local-faster-whisper.py");
  const args = [
    scriptPath,
    "--audio", wavPath,
    "--model", settings.localWhisperModel || "base",
    "--device", settings.localWhisperDevice || "auto",
    "--compute-type", settings.localWhisperComputeType || "default",
  ];
  if (settings.localWhisperLanguage) {
    args.push("--language", settings.localWhisperLanguage);
  }

  return new Promise((resolve, reject) => {
    execFile(
      python,
      args,
      { timeout: Number(settings.localWhisperTimeoutMs) || 120000, windowsHide: true },
      (error, stdout, stderr) => {
        let payload = null;
        try {
          payload = JSON.parse((stdout || "").trim());
        } catch (_) {}

        if (payload?.ok) {
          resolve(payload.text || "");
          return;
        }

        const message = payload?.error || stderr?.trim() || error?.message || "Faster Whisper failed";
        reject(new Error(message));
      }
    );
  });
}

function buildWAV(pcmData, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

// ── Public API ────────────────────────────────────────────

function startSession(provider, settings, onTranscript, onFinal, onError) {
  stopSession();

  switch (provider) {
    case "assemblyai":
      activeSession = new AssemblyAISession(settings.assemblyaiKey, onTranscript, onFinal, onError);
      break;
    case "deepgram":
      activeSession = new DeepgramSession(settings.deepgramKey, onTranscript, onFinal, onError);
      break;
    case "openai":
      activeSession = new OpenAIWhisperSession(settings.openaiKey, onTranscript, onFinal, onError);
      break;
    case "faster-whisper":
      activeSession = new LocalFasterWhisperSession(settings, onTranscript, onFinal, onError);
      break;
    case "apple":
      // Handled in renderer via webkitSpeechRecognition
      return null;
    default:
      throw new Error(`Unknown STT provider: ${provider}`);
  }

  return activeSession.start().then(() => activeSession);
}

function sendAudio(pcm16Buffer) {
  activeSession?.sendAudio(pcm16Buffer);
}

function requestFinal() {
  return activeSession?.requestFinal();
}

function stopSession() {
  activeSession?.stop();
  activeSession = null;
}

module.exports = { startSession, sendAudio, requestFinal, stopSession };
