/**
 * Session Logger
 *
 * Structured logging for conversations, actions, and outcomes.
 * Each app launch creates a new session log file. Every inference,
 * tool call, voice interaction, CU attempt, and cursor flight is
 * recorded with timestamps so we can review exactly what happened.
 *
 * Logs are written to ~/.cursorbuddy/logs/session-YYYY-MM-DD-HHmmss.jsonl
 * One JSON object per line (JSONL format) for easy grep/jq processing.
 *
 * Usage:
 *   const log = require('./lib/session-logger.js');
 *   log.event('inference:start', { provider: 'anthropic', model: '...' });
 *   log.event('inference:done', { responseLength: 500, hasPoint: true });
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || ".",
  ".cursorbuddy", "logs"
);

// Session ID: timestamp when the app launched
const SESSION_START = new Date();
const SESSION_ID = SESSION_START.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const LOG_FILE = path.join(LOG_DIR, `session-${SESSION_ID}.jsonl`);

let logStream = null;
let eventCounter = 0;
let consoleBroken = false;

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) {}
}

function getStream() {
  if (!logStream) {
    ensureLogDir();
    logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    logStream.on("error", () => {
      logStream = null;
    });
    // Write session header
    const header = {
      _type: "session_start",
      _seq: 0,
      _ts: SESSION_START.toISOString(),
      sessionId: SESSION_ID,
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron || "unknown",
      nodeVersion: process.version,
    };
    logStream.write(JSON.stringify(header) + "\n");
  }
  return logStream;
}

/**
 * Log a structured event.
 *
 * @param {string} type - Event type (e.g. 'inference:start', 'voice:stt_final', 'cu:result')
 * @param {object} [data] - Event-specific data
 */
function event(type, data) {
  eventCounter++;
  const entry = {
    _type: type,
    _seq: eventCounter,
    _ts: new Date().toISOString(),
    _elapsed: Date.now() - SESSION_START.getTime(),
    ...data,
  };

  // Write to file
  try {
    getStream().write(JSON.stringify(entry) + "\n");
  } catch (err) {
    safeConsole("error", "[Logger] Write failed:", err.message);
  }

  // Also log to console with compact format
  const tag = `[${type}]`;
  const compact = Object.entries(data || {})
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => {
      if (typeof v === "string" && v.length > 80) return `${k}="${v.slice(0, 77)}..."`;
      if (typeof v === "string") return `${k}="${v}"`;
      return `${k}=${JSON.stringify(v)}`;
    })
    .join(" ");
  safeConsole("log", tag, compact);
}

function safeConsole(method, ...args) {
  if (consoleBroken) return;
  try {
    console[method](...args);
  } catch (err) {
    if (err?.code === "EPIPE" || err?.code === "ERR_STREAM_DESTROYED") {
      consoleBroken = true;
      return;
    }
    throw err;
  }
}

/**
 * Log an error event.
 */
function error(type, err, data) {
  event(type, {
    error: err?.message || String(err),
    stack: err?.stack?.split("\n").slice(0, 3).join(" | "),
    ...data,
  });
}

/**
 * Close the log stream. Call on app quit.
 */
function close() {
  if (logStream) {
    event("session_end", { totalEvents: eventCounter });
    logStream.end();
    logStream = null;
  }
}

/**
 * Get the path to the current session log.
 */
function getLogPath() {
  return LOG_FILE;
}

/**
 * Get the log directory path.
 */
function getLogDir() {
  return LOG_DIR;
}

module.exports = { event, error, close, getLogPath, getLogDir, SESSION_ID };
