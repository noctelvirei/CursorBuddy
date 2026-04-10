/**
 * TTS Service
 *
 * Text-to-speech via ElevenLabs, Cartesia, or local Piper.
 * Returns audio data (Buffer) that the renderer plays via Web Audio.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ── ElevenLabs ────────────────────────────────────────────

async function elevenLabsSpeak(text, settings) {
  const apiKey = settings.elevenlabsKey;
  if (!apiKey) throw new Error("ElevenLabs API key not configured");

  const voiceId = settings.voiceId || "21m00Tcm4TlvDq8ikWAM";
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { audioData: Buffer.from(arrayBuffer), mimeType: "audio/mpeg" };
}

// ── Cartesia ──────────────────────────────────────────────

async function cartesiaSpeak(text, settings) {
  const apiKey = settings.cartesiaKey;
  if (!apiKey) throw new Error("Cartesia API key not configured");

  const voiceId = settings.cartesiaVoiceId || "d86c3a72-2a34-4db2-b49e-c693e8c4ae98";

  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      model_id: "sonic-2",
      transcript: text,
      voice: { mode: "id", id: voiceId },
      output_format: { container: "mp3", encoding: "mp3" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cartesia HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { audioData: Buffer.from(arrayBuffer), mimeType: "audio/mpeg" };
}

// ── Piper (local/offline) ─────────────────────────────────

async function piperSpeak(text, settings) {
  const executable = settings.localPiperExecutable || "piper";
  const modelPath = settings.localPiperModel;
  if (!modelPath) throw new Error("Piper model path not configured");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursorbuddy-piper-"));
  const outputPath = path.join(tempDir, "speech.wav");
  const args = ["--model", modelPath, "--output_file", outputPath];

  if (settings.localPiperConfig) {
    args.push("--config", settings.localPiperConfig);
  }
  if (settings.localPiperSpeaker) {
    args.push("--speaker", String(settings.localPiperSpeaker));
  }
  if (settings.localPiperLengthScale) {
    args.push("--length_scale", String(settings.localPiperLengthScale));
  }

  try {
    await runPiper(executable, args, text, Number(settings.localPiperTimeoutMs) || 60000);
    return { audioData: fs.readFileSync(outputPath), mimeType: "audio/wav" };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function runPiper(executable, args, text, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (_) {}
      reject(new Error("Piper timed out"));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Piper exited with code ${code}`));
      }
    });
    child.stdin.end(text);
  });
}

// ── Public API ────────────────────────────────────────────

async function speak(text, settings) {
  const provider = settings.ttsProvider || "elevenlabs";
  if (!text || !text.trim()) return null;

  switch (provider) {
    case "elevenlabs":
      return elevenLabsSpeak(text, settings);
    case "cartesia":
      return cartesiaSpeak(text, settings);
    case "piper":
      return piperSpeak(text, settings);
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

module.exports = { speak };
