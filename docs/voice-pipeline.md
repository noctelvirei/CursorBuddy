# Voice Pipeline

CursorBuddy has a full voice interaction pipeline: push-to-talk input, real-time speech-to-text, AI inference with vision, and spoken responses via text-to-speech.

---

## Overview

```
Push-to-talk → Microphone → STT Provider → Transcript
                                               ↓
                            Screenshot capture (all displays)
                                               ↓
                          Transcript + Screenshots → AI Provider
                                               ↓
                              Streaming response + POINT tags
                                               ↓
                         Sentence chunking → Parallel TTS prefetch
                                               ↓
                           Sequential audio playback + cursor pointing
```

---

## Speech-to-Text Providers

CursorBuddy supports local and online STT backends, configurable in settings:

### AssemblyAI (default)

- **Model:** `u3-rt-pro` (Universal 3 Real-Time Pro)
- **Transport:** WebSocket streaming (`wss://streaming.assemblyai.com/v3/ws`)
- **Audio format:** PCM16 mono, 16kHz
- **Features:** Turn-based formatting, real-time partial transcripts, `ForceEndpoint` for immediate finalization
- **Requires:** AssemblyAI API key

### Deepgram

- **Model:** `nova-3`
- **Transport:** WebSocket streaming (`wss://api.deepgram.com/v1/listen`)
- **Audio format:** Linear16, 16kHz, mono
- **Features:** Punctuation, interim results, VAD events
- **Requires:** Deepgram API key

### OpenAI Whisper

- **Model:** `gpt-4o-transcribe`
- **Transport:** Upload-based (not streaming)
- **Audio format:** WAV (PCM16, 16kHz, mono)
- **Behavior:** Buffers all audio during push-to-talk, uploads as WAV on release, returns final transcript
- **Requires:** OpenAI API key

### Faster Whisper (local)

- **Model:** Any Faster Whisper model name or local model path, for example `base`, `small`, or a local CTranslate2 model directory
- **Transport:** Local Python helper process
- **Audio format:** WAV (PCM16, 16kHz, mono)
- **Behavior:** Buffers all audio during push-to-talk, transcribes locally on release, returns final transcript
- **Requires:** Python with `faster-whisper` installed (`pip install faster-whisper`)
- **Settings:** Python executable, model, device, compute type, optional language. Defaults to CPU + int8 for reliable local startup.

### Apple Speech

- **Transport:** `webkitSpeechRecognition` in the renderer
- **Behavior:** Handled entirely in the browser/renderer, no main process involvement
- **Requires:** No API key (uses on-device speech recognition)

---

## Push-to-Talk

### Electron App

**Default shortcut:** `Ctrl+Alt+Space`

The shortcut is registered as a global shortcut via Electron's `globalShortcut` module. When activated:

1. Overlay switches to `listening` voice state (waveform)
2. STT session starts with the configured provider
3. Microphone audio streams to the STT WebSocket
4. Partial transcripts update in real-time
5. Second press stops recording → `ForceEndpoint` sent → final transcript emitted
6. Overlay switches to `processing` state (spinner)

### Web Embed

In browser mode, push-to-talk is controlled programmatically:

```ts
// Start listening
buddy.setVoiceState('listening');

// Drive the waveform
const interval = setInterval(() => {
  buddy.setAudioLevel(Math.random() * 0.7);
}, 50);

// Stop and process
clearInterval(interval);
buddy.setVoiceState('processing');

// Show response
buddy.setVoiceState('responding');
```

---

## Text-to-Speech Providers

### ElevenLabs (default)

- **Model:** `eleven_flash_v2_5`
- **Voice stability:** 0.5
- **Similarity boost:** 0.75
- **Output:** MP3
- **Requires:** ElevenLabs API key + voice ID

### Cartesia

- **Model:** `sonic-2`
- **Output:** MP3
- **Requires:** Cartesia API key + voice ID

### Piper (local)

- **Model:** Local `.onnx` Piper voice model
- **Transport:** Local Piper CLI process
- **Output:** WAV
- **Requires:** Piper installed locally and a voice model path configured
- **Settings:** Piper executable, model path, optional config path and speaker id

---

## Voice Response Pipeline

The `VoiceResponsePipeline` orchestrates streaming text into spoken audio with synchronized cursor pointing. Instead of waiting for the full AI response before speaking, it:

1. **Streams text** in from the inference provider word by word
2. **Detects sentence boundaries** (`.`, `!`, `?` followed by whitespace, or `[POINT:...]` tags)
3. **Prefetches TTS** for each sentence immediately (parallel network requests)
4. **Plays audio sequentially** — sentences play in order even though they were fetched in parallel
5. **Fires cursor movements** at the right moment — `[POINT:...]` tags trigger cursor flight as the corresponding sentence plays

This means the user hears the response almost immediately, and cursor pointing is timed to match the spoken words.

### Sentence Chunking

```
"click the save button in the top right. [POINT:1200,50:save button] then you can close the window."
                         ↓
Sentence 1: "click the save button in the top right."  → POINT before next
Sentence 2: "then you can close the window."
```

### POINT Tag Parsing

POINT tags are stripped from spoken text and used as timing markers:

```
[POINT:x,y:label]           → Point at (x,y) on cursor screen
[POINT:x,y:label:screen2]   → Point at (x,y) on screen 2
[POINT:none]                 → No pointing needed
```
