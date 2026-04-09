# CursorBuddy

Drop-in animated cursor companion. A blue triangle follows the mouse, flies to screen elements along bezier arcs, shows speech bubbles, and visualises voice states. Works two ways:

1. **Web embed** — `<script src="cursor-buddy.iife.js">` on any page, zero deps
2. **Electron desktop** — transparent overlay + tray icon, cross-platform (macOS/Windows/Linux)

## Quick Start

```bash
npm install

# Browser dev (cursor follows mouse, demo controls visible)
npm run dev

# Electron dev (overlay + tray icon + control panel)
npm run dev:electron

# Build the embeddable library (IIFE + ESM)
npm run build:lib

# Test the script-tag embed locally
npm run test:web

# Electron production
npm run build && npm start
```

## What it can do

- **Follow the cursor** with damped spring physics
- **Fly to coordinates, anchors, or DOM elements** along quadratic bezier arcs
- **Show speech bubbles** and voice-state visuals (idle, listening, processing, responding)
- **Start element selection mode** from the public API
- **Run as a browser embed or Electron desktop overlay** using the same event bus
- **Drive chat / AI workflows in Electron** with screen capture, MCP tooling, and TTS/STT services
- **Use Codex with ChatGPT sign-in** for read-only screen guidance without an API key

## Script Tag Usage

```html
<script src="cursor-buddy.iife.js"></script>
<script>
  const buddy = CursorBuddy.init();

  buddy.flyTo(500, 300, 'save button');
  buddy.flyToAnchor('top-right', 'settings');
  buddy.flyToElement(document.querySelector('.btn'), 'submit');
  buddy.flyToRandom('surprise', 'hello!');

  buddy.setVoiceState('listening');
  buddy.setAudioLevel(0.6);
  buddy.startSelection();

  buddy.on('cursor:arrived', () => console.log('arrived'));
  buddy.on('cursor:returned', () => console.log('returned'));
  buddy.on('selection:complete', (payload) => console.log(payload));

  buddy.show();
  buddy.hide();
  buddy.destroy();
</script>
```

## ESM Usage

```ts
import { init } from 'cursor-buddy';

const buddy = init();
buddy.flyToAnchor('top-right', 'settings');
buddy.setVoiceState('processing');
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Event Bus                            │
│  cursor:* · voice:* · capture:* · inference:* · tts:*        │
└──────┬──────────┬───────────┬──────────┬─────────────────────┘
       ▼          ▼           ▼          ▼
   Voice In   Capture    Claude AI   Cursor Overlay (this pkg)
```

### Compact Viewport

The overlay is a **320×80 transparent container** that follows the buddy:

- **Electron** — the viewport IS a `BrowserWindow`. Main process polls cursor at 60fps, renderer applies spring physics and moves the window via IPC.
- **Browser** — the viewport is a `position:fixed` div moved via CSS `transform`. Spring physics run in `requestAnimationFrame`.

Components render at **fixed local positions** inside the viewport. The viewport moves — not the components.

### Spring Physics

Cursor following uses a real damped spring (`response: 0.2`, `dampingFraction: 0.6`) ported from the SwiftUI original, not a CSS transition approximation. The spring runs per-frame in `requestAnimationFrame`.

### Bezier Flight

When flying to an element, the buddy follows a quadratic bezier arc with:
- Hermite smoothstep easing (`3t² - 2t³`)
- Tangent rotation (triangle faces direction of travel)
- Sine scale pulse (1.0× → 1.3× → 1.0×)
- Duration scales with distance (0.6s–1.4s)

## Project Structure

```
cursor-buddy/
├── src/                           # React components + library entrypoints
│   ├── index.ts                   # Public API → init()
│   ├── App.tsx                    # Dev app wrapper
│   ├── main.tsx                   # Vite browser entry
│   ├── components/
│   │   ├── CursorOverlay.tsx      # Root overlay composer
│   │   ├── OverlayViewport.tsx    # Platform-aware moving viewport
│   │   ├── BlueCursorTriangle.tsx # Triangle cursor + glow
│   │   ├── BlueCursorWaveform.tsx # Audio-reactive waveform
│   │   ├── BlueCursorSpinner.tsx  # Processing spinner
│   │   ├── NavigationBubble.tsx   # Speech bubble + streamed text
│   │   ├── ChatPanel.tsx          # Embedded chat UI
│   │   └── ElementSelector.tsx    # Click-drag DOM selection overlay
│   ├── hooks/
│   │   ├── use-cursor-tracking.ts # Spring-smoothed cursor following
│   │   └── use-buddy-navigation.ts# Bezier flight orchestration
│   ├── stores/cursor-store.ts     # Zustand state
│   ├── events/event-bus.ts        # Typed EventEmitter API boundary
│   └── lib/
│       ├── bezier-flight.ts       # Quadratic bezier math
│       ├── spring-physics.ts      # Damped spring simulation
│       ├── viewport-bounds.ts     # Screen / viewport helpers
│       ├── point-tag-parser.ts    # [POINT:x,y:label] parsing
│       ├── design-tokens.ts       # Colors, sizes, constants
│       ├── move-overlay-window.ts # Electron window IPC bridge
│       ├── is-electron.ts         # Runtime platform detection
│       └── runtime-config.ts      # Config loading / defaults
├── electron/                      # Desktop shell + services
│   ├── main.js                    # Tray + overlay + panel windows
│   ├── preload.js                 # Overlay bridge
│   ├── preload-panel.js           # Panel bridge
│   ├── panel.html                 # Frameless control panel
│   ├── services/                  # Capture, inference, MCP, TTS/STT
│   └── lib/                       # IPC helpers, settings, session utils
├── docs/                          # Full documentation site content
├── packages/cli/                  # Terminal CLI package
├── test.html                      # Local script-tag test page
├── vite.config.ts                 # App dev / build config
└── vite.lib.config.ts             # Library build (IIFE + ESM)
```

### Additional Source Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Dev app root (wraps overlay + demo controls) |
| `src/main.tsx` | Vite dev entry point |
| `src/components/ChatPanel.tsx` | Chat interface component |
| `src/components/ElementSelector.tsx` | DOM element picker for flyTo targets |
| `src/lib/is-electron.ts` | Electron environment detection utility |
| `src/lib/runtime-config.ts` | Runtime configuration management |

## Documentation

Start with [docs/index.md](docs/index.md). The docs cover [getting started](docs/getting-started.md), the [API reference](docs/api-reference.md), [event bus](docs/event-bus.md), [voice pipeline](docs/voice-pipeline.md), [AI inference](docs/ai-inference.md), [screen capture](docs/screen-capture.md), [MCP integration](docs/mcp-integration.md), [element selector](docs/element-selector.md), [design tokens](docs/design-tokens.md), and [architecture](docs/architecture.md).

## Electron Details

- **Tray icon** — click to toggle the control panel. Right-click for quit.
- **Overlay window** — 320×80, transparent, frameless, always-on-top, click-through, visible on all workspaces. Positioned by spring physics in the renderer.
- **Panel window** — frameless, transparent background, rounded corners, custom drag region. Positioned near the tray icon. Tabs: Playground, Config, Theme.
- **Screen tracking** — `screen.getDisplayNearestPoint()` detects which monitor the cursor is on. Bounds re-broadcast on monitor change.
- **No dock icon** on macOS (`app.dock.hide()`). No taskbar entry for the overlay.

## License

This project is licensed under [AGPL-3.0-only](LICENSE) — the GNU Affero General Public License v3.0.
