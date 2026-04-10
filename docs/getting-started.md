# Getting Started

Get CursorBuddy running in under 5 minutes.

---

## Prerequisites

- **Node.js** 18+ (for building and Electron)
- **npm** (comes with Node.js)

## Install

```bash
git clone https://github.com/your-org/cursor-buddy.git
cd cursor-buddy
npm install
```

## Choose Your Mode

### Browser Development (cursor follows your mouse)

```bash
npm run dev
```

Opens `http://localhost:1420` with the overlay + demo controls. Move your mouse to see the buddy follow. Use the dev panel in the bottom-left corner to test voice states, flight animations, and audio simulation.

### Electron Desktop App (system-wide overlay)

```bash
npm run dev:electron
```

Launches two windows:
1. **Overlay** — a small transparent window (320×80px) that follows your real system cursor
2. **Panel** — a frameless settings/chat panel accessible from the tray icon

The tray icon appears in your system tray. Click it to toggle the panel.

### Library Build (for embedding in other sites)

```bash
npm run build:lib
```

Produces:
- `dist/cursor-buddy.iife.js` — self-contained bundle for `<script>` tags
- `dist/cursor-buddy.es.js` — ESM module for `import` statements
- `dist/index.d.ts` — TypeScript declarations

### Test the Web Embed

```bash
npm run test:web
```

Builds the library, starts a local server on port 3333, and opens `test.html` in your browser.

---

## Project Structure

```
cursor-buddy/
├── src/                    # Library source (React + TypeScript)
│   ├── index.ts            # Library entry point + public API
│   ├── components/         # React components (overlay, triangle, waveform, etc.)
│   ├── hooks/              # React hooks (cursor tracking, navigation)
│   ├── stores/             # Zustand state store
│   ├── events/             # Typed event bus
│   └── lib/                # Pure utilities (bezier, spring, viewport, etc.)
├── electron/               # Electron main process
│   ├── main.js             # App entry — tray, overlay window, panel window
│   ├── preload.js          # Overlay window bridge (cursor, window position)
│   ├── preload-panel.js    # Panel window bridge (settings, inference)
│   ├── panel.html          # Panel UI (settings, chat, MCP config)
│   └── services/           # Backend services
│       ├── capture.js      # Screenshot capture via desktopCapturer
│       ├── inference.js    # Multi-provider AI inference (Anthropic, OpenAI, Ollama, LM Studio)
│       ├── transcription.js # Speech-to-text (AssemblyAI, Deepgram, OpenAI Whisper, Faster Whisper)
│       ├── tts.js          # Text-to-speech (ElevenLabs, Cartesia, Piper)
│       ├── mcp-server.js   # CursorBuddy as an MCP tool server
│       ├── mcp-client.js   # Connect to external MCP servers
│       ├── tool-loader.js  # Load custom tools from filesystem
│       └── voice-response.js # Pipeline: streaming text → sentence TTS → cursor pointing
├── dist/                   # Build output
├── docs/                   # This documentation
├── test.html               # CDN embed test page
├── vite.config.ts          # Dev server + Electron app build
└── vite.lib.config.ts      # Library build (IIFE + ESM)
```

---

## Build Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Vite dev server (browser mode with demo controls) |
| `npm run dev:electron` | Vite dev server + Electron app |
| `npm run build` | TypeScript check + Vite production build |
| `npm run build:lib` | Library build → IIFE + ESM bundles |
| `npm run test:web` | Build lib + serve `test.html` locally |
| `npm start` | Launch Electron from production build |
| `npm run preview` | Preview the Vite production build |

---

## Next Steps

- [Web Embed Guide](./web-embed.md) — add CursorBuddy to your website
- [Electron App Guide](./electron-app.md) — configure the desktop companion
- [API Reference](./api-reference.md) — full programmatic control
