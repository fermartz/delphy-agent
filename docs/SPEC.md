# Spec

This document defines the **external-facing contracts** of Delphy Agent — the file formats, configuration shapes, and user-visible behaviors that someone outside the core codebase can depend on.

For *how* the app is built, see `ARCHITECTURE.md`. For *why*, see `VISION.md`.

If a contract here changes in a backward-incompatible way, it requires a version bump on the field that owns it (see [Versioning](#versioning)).

---

## Contracts at a glance

| Contract | Audience | Defined in |
|----------|----------|------------|
| Theme JSON | Theme authors | [`THEMES.md`](./THEMES.md) — full schema lives there |
| MCP server config | Power users, plugin authors, MCP server publishers | This doc |
| Settings file | Power users editing config directly | This doc |
| Session export | Anyone exporting/importing conversation history | This doc |
| Built-in slash commands | Anyone typing `/<name>` in the chat input | This doc |
| Custom user-defined slash commands | Users automating common prompts via JSON | This doc *(v1: defer)* |
| URL scheme (`delphy-agent://`) | Deep links from web / other apps | This doc *(v1: defer)* |

---

## Theme JSON

The theme file format is fully defined in [`THEMES.md`](./THEMES.md). The contract summary:

- One JSON file per theme; loadable from the app's built-in directory or `~/.config/delphy-agent/themes/`
- Required: `id`, `label`, `light`, `dark` (with all required color tokens in both)
- Optional: `author`, `version`, `description`, `tokens`
- Light + dark variants are both required; "dark-only" or "light-only" themes are not supported in v1
- A user theme with the same `id` as a built-in **overrides** the built-in

Version field: free-form string today; treated as opaque metadata. May become enforced semver in a future revision.

---

## MCP server configuration

Each MCP server known to the app is one record in the `mcp_servers` SQLite table, but the **external shape** — what users edit through the UI, what gets exported, what a "share this MCP" file looks like — is this JSON:

```json
{
  "id": "github-issues",
  "name": "GitHub Issues",
  "enabled": true,
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "${secret:github_pat}"
  },
  "scopes": ["read", "write"]
}
```

### Fields

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `id` | yes | string | Kebab-case, unique. `^[a-z][a-z0-9-]*$` |
| `name` | yes | string | Display name |
| `enabled` | yes | boolean | Whether the server is started at app launch |
| `transport` | yes | `"stdio"` \| `"http"` \| `"sse"` | Transport protocol |
| `command` | conditional | string | Required when `transport: "stdio"` |
| `args` | no | string[] | For `stdio` transport |
| `env` | no | `Record<string, string>` | For `stdio` transport. Values may reference secrets via `${secret:<key>}` (see below) |
| `url` | conditional | string | Required when `transport: "http"` or `"sse"` |
| `headers` | no | `Record<string, string>` | For `http` / `sse`. Supports `${secret:<key>}` |
| `scopes` | no | string[] | Reserved for future capability gating. Currently informational |

### Secret references

Any `env` or `headers` value matching `${secret:<key>}` is resolved at MCP server startup against the app's secret store (see ARCHITECTURE → Storage → Secret store). The literal `${secret:...}` token never leaves the secret-store boundary; it is replaced with the resolved value before the subprocess is spawned or the HTTP request is made.

This is the only way to put credentials into an MCP config. Inline secrets in `env` or `headers` are rejected.

### Validation rules

A config is **rejected** if:
- `id` is missing or invalid
- `transport` is not one of the three allowed values
- `transport` is `"stdio"` but `command` is missing
- `transport` is `"http"` or `"sse"` but `url` is missing
- Any `env` or `headers` value contains a literal API key pattern (Anthropic `sk-ant-...`, OpenAI `sk-...`, etc.) — flagged as a security error with a hint to use `${secret:...}`

### Sharing MCP configs

A user can export any MCP config as a JSON file matching the shape above. Importing the file:
- Adds it to the registry if `id` is new
- Prompts the user to confirm overwrite if `id` already exists
- Always strips/leaves placeholder `${secret:...}` references — the recipient must fill their own secret values

---

## Settings file

App preferences (selected theme, color mode, default backend) live in Tauri Store. Power users may edit the file directly. Format is defined here so that edits are stable.

Location: platform-native app-data directory via Tauri's `app_data_dir()` resolution. With bundle identifier `app.delphy.agent`:

- **macOS:** `~/Library/Application Support/app.delphy.agent/settings.json`
- **Linux:** `~/.local/share/app.delphy.agent/settings.json`
- **Windows:** `%APPDATA%\app.delphy.agent\settings.json`

```json
{
  "$schema": "https://delphy.app/schemas/settings/v1.json",
  "selected_theme": "perpetuity",
  "color_mode": "system",
  "default_backend": "anthropic-api",
  "main_model": "claude-opus-4-7",
  "auxiliary_model": "claude-haiku-4-5",
  "window_state": {
    "width": 1200,
    "height": 800,
    "x": null,
    "y": null
  }
}
```

### Fields

| Field | Type | Allowed values |
|-------|------|----------------|
| `selected_theme` | string | Any registered theme `id` |
| `color_mode` | string | `"light"` \| `"dark"` \| `"system"` |
| `default_backend` | string | Any registered adapter `id` |
| `main_model` | string | Provider/model ID used for the user-visible turn (e.g. `claude-opus-4-7`, `gpt-5`) |
| `auxiliary_model` | string | Provider/model ID used for compaction, title generation, and search-helper calls. Should be a cheap, fast model (e.g. `claude-haiku-4-5`, `gemini-2.5-flash`) |
| `window_state` | object \| null | Free-form, managed by the app |

Unknown keys are preserved on write (forward compatibility). Invalid values fall back to defaults with a startup warning.

The `$schema` URL is currently aspirational — there is no hosted schema in v1. Reserved for future automation.

---

## Session export

Users can export a session to a single `.json` file. The format is stable across patch versions; major versions may add fields (additively) but will not remove required ones.

```json
{
  "$schema": "https://delphy.app/schemas/session/v1.json",
  "version": "1.0.0",
  "session": {
    "id": "ses_01HXY...",
    "backend_id": "claude-code",
    "title": "Refactor the cache layer",
    "created_at": 1716624000000,
    "updated_at": 1716627600000
  },
  "messages": [
    {
      "seq": 0,
      "role": "user",
      "content": [{ "type": "text", "text": "Help me refactor..." }],
      "created_at": 1716624000000
    },
    {
      "seq": 1,
      "role": "assistant",
      "content": [
        { "type": "text", "text": "Sure — let me look at it." },
        { "type": "tool_call", "id": "tc_1", "name": "Read", "input": { "path": "..." } },
        { "type": "tool_result", "id": "tc_1", "output": "...", "is_error": false }
      ],
      "created_at": 1716624005000
    }
  ]
}
```

### Content block types

A message's `content` is an ordered array of typed blocks:

| Type | Required fields | Notes |
|------|-----------------|-------|
| `text` | `text` | Plain text |
| `thinking` | `text` | Model reasoning (where the backend exposes it) |
| `tool_call` | `id`, `name`, `input` | `input` is provider-specific JSON |
| `tool_result` | `id`, `output`, `is_error` | `output` is provider-specific JSON |
| `image` | `mime_type`, `data` *(base64)* | Optional in v1 |

### Import behavior

- Imported sessions are created as new records with new IDs — no overwrite of existing sessions
- `backend_id` is preserved as a label; if the backend is not registered locally, the session is still imported but read-only
- Timestamps are preserved as exported

### Secrets in exports

Exports never contain API keys, OAuth tokens, or MCP env values. If a tool input/output contained a secret-looking string at runtime, it is the user's responsibility to redact before sharing — Delphy Agent does not auto-redact.

---

## Built-in slash commands

Chat input lines that begin with `/<name>` (a leading `/` followed by one-or-more alphanumeric / `-` / `_` characters) are parsed as **built-in commands** and dispatched locally instead of being sent to the LLM. Everything else — including `//`, `/ ` (slash + whitespace), `///`, and any `/` mid-line — is treated as a regular message.

Output is rendered as `system` chat items, visually distinct from user / assistant / runtime-error items (neutral gray, monospace, italic).

### v1 built-in commands

| Name | Arg | Description |
|------|-----|-------------|
| `/help` | — | List every registered command with its description. |
| `/clear` | — | Wipe the chat history and start a fresh session. Emits "Chat cleared." in the now-empty chat. |
| `/model` | `[<model-id>]` | With no arg, opens the model picker. With a `<model-id>`, validates against the provider's available models (via `fetchModels()`), saves `main_model` to settings, and restarts the session so the new model takes effect on the next message. |
| `/compact` | `[<focus>]` | Compress the middle of the current conversation into a single summary message, freeing token budget. With no arg, summarizes generically; with `<focus>`, biases the summary toward the focus topic. Output: `Compacted: <N> → <M> messages, ~<X> tokens saved.` Head messages and the most recent tail (under a token budget) are preserved verbatim. Compaction also fires automatically before the next chat turn when estimated usage crosses ~85% of the model's context window, with an anti-thrashing rule that skips if the previous compaction saved less than ~10% of tokens. The auto-trigger surfaces its status via a system message ("Compacting older turns…" then "Auto-compacted: N → M, ~X tokens saved."). |

### Error shapes

- Unknown command: `Unknown command: /<name>. Type /help for available commands.`
- `/model <unknown-id>`: `Model not found: <id>. Type /model (no args) to open the picker and see available models.`
- `/model <id>` when `fetchModels()` fails (network etc.): `Could not verify model id (<reason>). Saved optimistically; the next message will surface a runtime error if the id is wrong.` The value IS saved + the session restarts; the next chat turn will validate it against the live API.
- `/compact` on a backend that doesn't support compaction (e.g., the echo fallback): `Compact is not supported by the echo adapter.`
- `/compact` when the conversation is too short to compact (below the head + middle + tail threshold): `Nothing to compact — conversation is too short.`
- `/compact` when the auxiliary model call fails (network, invalid key, etc.): the underlying error message is surfaced as a system chat item. The session's messages array is left unchanged; subsequent chat continues to work.

---

## Custom user-defined slash commands (v1: defer)

Users may want to define reusable prompts as `/foo` commands. Sketch:

```json
{
  "name": "summarize",
  "description": "Summarize the current selection or last assistant message",
  "prompt": "Summarize this in 3 bullet points:\n\n{{input}}"
}
```

Stored at `~/.config/delphy-agent/commands/*.json`.

Deferred from v1 — record here so the file location is reserved.

---

## URL scheme (v1: defer)

Reserved scheme: `delphy-agent://`.

Anticipated uses:
- `delphy-agent://session/<id>` — open an existing session
- `delphy-agent://mcp/install?config=<base64-json>` — prompt to install an MCP server
- `delphy-agent://theme/install?url=<url>` — prompt to install a theme from a URL

Not implemented in v1. Reserved here so we don't paint into a corner with the registration.

---

## Versioning

Each external contract carries its own version, embedded in the file:
- Theme files: `version` field (free-form today)
- Session exports: `version` field, semver, this doc enforces compatibility rules
- Settings file: implicit via `$schema` URL (future)
- MCP config: no version field today — additive changes only until a breaking change forces one

### Compatibility rules
- **Patch (`1.0.x`)**: any change. Older readers must ignore unknown fields.
- **Minor (`1.x.0`)**: additive fields only. Older readers must still parse the file successfully.
- **Major (`x.0.0`)**: breaking changes. Apps may refuse to load or offer a migration path.

The app reads any older minor/patch version. The app may refuse to read a major version it doesn't understand, with a clear error.

---

## Out of scope for v1

These would be reasonable to spec in the future but are explicitly **not** part of v1's contract surface:

- Plugin loading from third-party JS / WASM (MCP is the extensibility path)
- Programmatic embedding (no `@delphy-agent/sdk` package planned)
- Headless / CLI mode
- Multi-user / shared sessions
- Cloud sync of settings or sessions
