# AI & Inference

CursorBuddy connects to multiple AI providers for vision-enabled chat with streaming responses, tool use, and extended thinking.

---

## Supported Providers

| Provider | Models | Vision | Streaming | Tool Use | Local |
|----------|--------|--------|-----------|----------|-------|
| **Anthropic** | Claude Sonnet 4.6, Opus, Haiku | ✅ | ✅ | ✅ | ❌ |
| **Codex** | GPT-5.4 | ✅ | ✅ | ❌ | ✅ |
| **OpenAI** | GPT-4o, o3, o4-mini | ✅ | ✅ | ❌ | ❌ |
| **Ollama** | LLaVA, any vision model | ✅* | ✅ | ❌ | ✅ |
| **LM Studio** | Any vision model | ✅* | ✅ | ❌ | ✅ |

*Vision support depends on the specific model loaded.

---

## How It Works

Every AI message includes:

1. **System prompt** — CursorBuddy's personality, rules, and element pointing instructions
2. **Conversation history** — up to 10 previous turns
3. **Screenshots** — JPEG images of all connected displays, labeled with dimensions and cursor location
4. **User transcript** — the spoken or typed message
5. **Available tools** — MCP tools and custom tools, if any are loaded

The AI responds with streaming text. If it identifies a UI element to point at, it appends a `[POINT:x,y:label]` tag at the end of its response.

---

## System Prompt

The system prompt establishes CursorBuddy's behavior:

- **Conversational tone** — all lowercase, casual, warm, no emojis
- **Concise by default** — one or two sentences, but elaborates when asked
- **Written for speech** — no lists, bullet points, or markdown (responses are spoken aloud)
- **Screen-aware** — references specific things visible in the screenshots
- **Points at things** — uses `[POINT:x,y:label]` tags when pointing would help
- **Tool-aware** — uses MCP tools when available and helpful

---

## Anthropic (Claude)

### Configuration

```json
{
  "chatProvider": "anthropic",
  "chatModel": "claude-sonnet-4-6",
  "anthropicKey": "sk-ant-..."
}
```

### Features

- **Vision** — screenshots sent as `image` content blocks with `base64` source
- **Streaming** — real-time text chunks via the Anthropic SDK
- **Tool use** — MCP and custom tools are passed as Anthropic tool definitions; tool calls are executed automatically in a loop (up to 5 rounds)
- **Extended thinking** — when enabled, sends `thinking.budget_tokens` and returns reasoning blocks

### Extended Thinking

```json
{
  "chatReasoningEnabled": true,
  "chatReasoningBudget": 4096
}
```

When thinking is enabled, `max_tokens` is automatically set to at least `budget + 1024`. Thinking blocks are streamed as `{ type: "thinking", text }` chunks.

### Computer Use Fallback

If Claude doesn't return a `[POINT:...]` tag and Computer Use is configured, CursorBuddy falls back to Anthropic's Computer Use API:

1. Sends the cursor screen's screenshot with the user's question
2. Claude identifies the UI element and returns click coordinates
3. Coordinates are scaled from the CU resolution to logical screen pixels

Computer Use resolutions are matched to display aspect ratio:
- 1024×768 (4:3)
- 1280×800 (16:10, Mac default)
- 1366×768 (~16:9)

---

## OpenAI

### Configuration

```json
{
  "chatProvider": "openai",
  "chatModel": "gpt-4o",
  "openaiKey": "sk-..."
}
```

### Reasoning Models (o3, o4-mini)

When `chatReasoningEnabled` is true and the model starts with `o3` or `o4`, CursorBuddy sets `reasoning_effort` instead of `thinking`:

| Budget Tokens | Reasoning Effort |
|--------------|-----------------|
| ≤ 1024 | `low` |
| ≤ 8192 | `medium` |
| > 8192 | `high` |

Temperature is removed for reasoning models (they don't use it).

---

## Codex

### Configuration

```json
{
  "chatProvider": "codex",
  "chatModel": "gpt-5.4"
}
```

### Auth

Codex uses **Sign in with ChatGPT** through the Codex App Server. No OpenAI API key is required for the CursorBuddy chat slot when Codex is selected.

CursorBuddy starts a local Codex App Server client, checks auth state, and opens the ChatGPT login flow in the browser when needed. Codex manages token refresh internally.

### Behavior

- **Vision** — screenshots are sent as local image inputs to Codex
- **Streaming** — agent message deltas stream back into the panel as they arrive
- **Read-only** — CursorBuddy starts Codex with `approvalPolicy: "never"` and a read-only sandbox
- **No external tool injection** — CursorBuddy does not pass MCP tools, custom tools, or system action tools to Codex in v1
- **Same pointing contract** — Codex replies still use the existing `[POINT:x,y:label]` format

### Conversation state

Codex keeps an in-memory thread for the current app session so follow-up messages stay conversational. Clearing chat resets the active Codex thread.

---

## Ollama (Local)

### Configuration

```json
{
  "chatProvider": "ollama",
  "chatModel": "llava",
  "ollamaUrl": "http://localhost:11434"
}
```

Uses the OpenAI-compatible API at `{ollamaUrl}/v1`. Vision is supported if the model name contains `llava` or `vision`.

---

## LM Studio (Local)

### Configuration

```json
{
  "chatProvider": "lmstudio",
  "chatModel": "your-model-name",
  "lmstudioUrl": "http://localhost:1234"
}
```

Same OpenAI-compatible interface as Ollama.

---

## Conversation History

For Anthropic, OpenAI, Ollama, and LM Studio, the main process maintains conversation history (up to 10 turns). Each turn stores the user's transcript and the assistant's full response. History is included with every new message so the AI has context.

```ts
// Clear history programmatically
ipcMain.on('inference:clear-history', () => clearHistory());
```

When Codex is selected, CursorBuddy clears the active Codex thread alongside the local history cache.

---

## Tool Use Loop

When MCP tools or custom tools are available, Anthropic requests may trigger tool calls:

```
User message → Claude response (with tool_use blocks)
                       ↓
              Execute tools (MCP or custom)
                       ↓
              Tool results → Continue conversation
                       ↓
              Claude response (possibly more tool calls)
                       ↓
              ... up to 5 rounds
```

Each tool use block is relayed to the UI as `{ type: "tool_use", name, input }` and `{ type: "tool_result", name, result }` chunks.

---

## Coordinate Mapping

When Claude returns `[POINT:640,360:button]`, those coordinates are in **screenshot pixel space** (e.g., within a 1280×720 image). The main process scales them to logical screen coordinates:

```
screen_x = display_x + point_x × (display_width / screenshot_width)
screen_y = display_y + point_y × (display_height / screenshot_height)
```

The scaled coordinates are sent to the overlay as `cursor:fly-to` events.
