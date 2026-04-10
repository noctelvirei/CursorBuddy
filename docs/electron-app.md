# Electron Desktop App

CursorBuddy runs as a system-wide transparent overlay on macOS, Windows, and Linux. A tray icon gives you quick access to a chat panel, settings, and AI configuration.

---

## Running

```bash
npm install
npm run dev:electron    # Development (hot-reload)
npm start               # Production (from built files)
```

## What Gets Created

The Electron app creates three things:

### 1. Tray Icon

A small blue icon in your system tray / menu bar. Click it to toggle the control panel. Right-click for a context menu with "Toggle Panel" and "Quit".

### 2. Overlay Window (320×80px)

A transparent, frameless, click-through window that follows your cursor at 60fps. It hosts:

- **Blue cursor triangle** — your buddy, offset 35px right and 25px below the system cursor
- **Waveform / spinner** — shown during voice states
- **Speech bubble** — shown when pointing at elements

The overlay window is:
- Always on top (screen-saver level)
- Visible on all workspaces / virtual desktops
- Ignores mouse events (fully click-through)
- No shadow, no frame, transparent background

### 3. Panel Window (680×580px)

A frameless, transparent, always-on-top window that drops down from the tray icon. Contains:

- **Chat interface** — type messages or see voice transcripts
- **Settings** — API keys, provider selection, model configuration
- **Codex auth** — sign in with ChatGPT for the Codex chat provider
- **MCP management** — connect to external tool servers
- **Voice controls** — push-to-talk settings, TTS configuration
- **Cursor customization** — color, size, glow, spring tuning

The panel hides (not closes) when you click away or press the tray icon again.

---

## Cursor Tracking

The main process polls `screen.getCursorScreenPoint()` every 16ms (~60fps) and sends the position to the overlay renderer via IPC. The renderer applies spring physics and sends the smoothed position back to move the window.

When the cursor moves to a different display, the main process detects the display change and broadcasts updated screen bounds to both the overlay and panel windows.

---

## Push-to-Talk

**Default shortcut:** `Ctrl+Alt+Space` (cross-platform)

Press the shortcut to start recording. The overlay switches to the listening state (waveform). Audio streams to the configured speech-to-text provider. Press again to stop recording.

The full pipeline:
1. Push-to-talk activates → overlay shows waveform
2. Audio streams to STT provider (AssemblyAI, Deepgram, OpenAI Whisper, or local Faster Whisper)
3. Key release → final transcript
4. Screenshot capture of all displays
5. Transcript + screenshots sent to AI (Claude, Codex, GPT-4o, Ollama, or LM Studio)
6. AI response streams back → overlay shows spinner → then responding state
7. `[POINT:x,y:label]` tags parsed → cursor flies to the element
8. TTS speaks the response aloud

---

## Screenshot Interceptor

CursorBuddy watches your clipboard every 500ms. When it detects a new screenshot (e.g., from `Cmd+Shift+4` on macOS), it:

1. Captures a thumbnail for the panel UI
2. Stores the full image for AI context
3. Triggers a cursor fly-to animation with "screenshot captured!"
4. Attaches the screenshot to your next AI message

This means the AI can see and discuss screenshots you take outside the app.

---

## Settings Storage

Settings are persisted to `~/.cursorbuddy/settings.json`. This includes:

- API keys (Anthropic, OpenAI, ElevenLabs, Cartesia, AssemblyAI, Deepgram)
- Local voice backend paths (Faster Whisper Python/model settings and Piper executable/model settings)
- Provider selections (chat, STT, TTS)
- Model choices
- Extended thinking / reasoning configuration
- MCP server connections
- Voice and cursor preferences

Codex sign-in state is managed by Codex itself and cached in the user's Codex auth store rather than inside CursorBuddy's settings file.

---

## Multi-Monitor Support

CursorBuddy handles multiple displays:

- **Cursor tracking** detects which display the cursor is on
- **Screen capture** captures all connected displays with labeled images
- **Coordinate mapping** converts between screenshot pixels and logical screen pixels using per-display scale factors
- **Display change events** (add/remove/metrics change) trigger re-broadcast of screen bounds

The AI receives labeled screenshots like:
```
screen 1 of 2 — cursor is on this screen (primary focus) (image dimensions: 1280x720 pixels)
screen 2 of 2 — secondary screen (image dimensions: 1280x800 pixels)
```

When the AI responds with `[POINT:640,360:button:screen2]`, CursorBuddy maps those screenshot coordinates to the correct physical display.

---

## Cross-Platform Notes

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Tray icon | Menu bar | System tray | System tray |
| Overlay type | `panel` | Default | Default |
| Dock visibility | Hidden via `app.dock.hide()` | Skip taskbar | Skip taskbar |
| Screenshot capture | `desktopCapturer` | `desktopCapturer` | `desktopCapturer` |
| Panel position | Below tray icon | Above tray icon | Above tray icon |
| HiDPI | Retina `scaleFactor` | DPI scaling | X11/Wayland scaling |
