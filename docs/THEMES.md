# Themes

Delphy Agent ships with a set of curated themes and lets users add their own as plain JSON files. Themes are not hardcoded into the app — they are data the app loads and applies at runtime.

This document is the source of truth for:
- The theme file format (the contract third-party theme authors follow)
- How themes are loaded, validated, and applied at runtime
- Which themes ship built-in

When ARCHITECTURE.md and SPEC.md are written, the runtime/loader sections will move into ARCHITECTURE.md and the file-format sections into SPEC.md. Until then, the full picture lives here.

---

## Goals

1. **Extensible by users.** Drop a JSON file in the user theme directory and it appears in the picker — no rebuild, no code change.
2. **Validated.** Malformed themes fail loudly with clear errors, not silently broken UIs.
3. **Shareable.** A theme is one file. Copy, paste, send, version-control.
4. **Uniform code path.** Built-in themes and user themes load through the same loader; no special cases.
5. **Light + dark required.** Every theme must support both color modes.

---

## File format

A theme is a single JSON file matching this shape:

```json
{
  "id": "perpetuity",
  "label": "Perpetuity",
  "author": "tweakcn",
  "version": "1.0.0",
  "description": "Monospace terminal theme",
  "tokens": {
    "font-sans": "JetBrains Mono, monospace",
    "font-mono": "JetBrains Mono, monospace",
    "radius": "0.125rem"
  },
  "light": {
    "background": "oklch(0.9491 0.0085 197.0126)",
    "foreground": "oklch(0.3772 0.0619 212.664)",
    "primary": "oklch(0.5624 0.0947 203.2755)"
  },
  "dark": {
    "background": "oklch(0.2068 0.0247 224.4533)",
    "foreground": "oklch(0.852 0.1269 195.0354)",
    "primary": "oklch(0.852 0.1269 195.0354)"
  }
}
```

### Top-level fields

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `id` | yes | string | Kebab-case, unique. Used as the `data-theme` value and as the picker key. `^[a-z][a-z0-9-]*$` |
| `label` | yes | string | Display name in the picker |
| `author` | no | string | Free-form credit |
| `version` | no | string | Semver-ish, free-form |
| `description` | no | string | One-liner for UI |
| `tokens` | no | object | Non-color tokens — fonts, radius, etc. See below |
| `light` | yes | object | Color tokens for light mode. All required color tokens must be present |
| `dark` | yes | object | Color tokens for dark mode. All required color tokens must be present |

### Required color tokens (in both `light` and `dark`)

Each value must be a valid CSS color string. OKLCH is preferred for perceptual consistency but HSL / hex / rgb / named colors all work.

- `background`, `foreground`
- `card`, `card-foreground`
- `popover`, `popover-foreground`
- `primary`, `primary-foreground`
- `secondary`, `secondary-foreground`
- `muted`, `muted-foreground`
- `accent`, `accent-foreground`
- `destructive`, `destructive-foreground`
- `border`, `input`, `ring`
- `chart-1`, `chart-2`, `chart-3`, `chart-4`, `chart-5`
- `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-primary-foreground`, `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border`, `sidebar-ring`

A theme missing any required color token in either mode is rejected.

### Optional non-color tokens (`tokens` object)

- `font-sans` — primary UI font stack
- `font-mono` — monospace font stack (code blocks, terminal-ish UI)
- `radius` — base border radius (e.g. `0.5rem`, `0.125rem`)

Anything else in `tokens` is ignored at runtime, but is preserved (useful for forward-compatible theme metadata).

---

## Where themes live

### Built-in themes
- Bundled in the app at `src/themes/builtin/*.json`
- Loaded synchronously at startup via static imports
- Cannot be removed by the user, but can be hidden in settings

### User themes
- Loaded from `app_data_dir()/themes/*.json` — the platform-native data directory resolved by Tauri:
  - macOS: `~/Library/Application Support/app.delphy.agent/themes/`
  - Linux: `~/.local/share/app.delphy.agent/themes/`
  - Windows: `%APPDATA%\app.delphy.agent\themes\`
- The directory is created at first boot if it doesn't exist.
- Scanned at startup and watched for changes (added / modified / removed) — picker updates live, no app restart needed.
- A user theme with the same `id` as a built-in **overrides** the built-in (lets users tweak a curated theme without forking the codebase).
- Path note: an earlier draft of this doc named `~/.config/delphy-agent/themes/`; the implementation uses `app_data_dir()` instead, consistent with the settings-file path decision (see `docs/DECISIONS.md`).

---

## Runtime: how a theme is applied

1. **Load:** Loader reads all built-in JSON files + scans the user theme directory.
2. **Validate:** Each theme is validated against the Zod schema. Invalid themes are dropped with a `console.warn` naming the file and the parse / validation error; the rest continue to load. (A visible-toast variant for theme errors is a future polish slice — for v1, errors are visible in the devtools console.)
3. **Register:** Valid themes go into an in-memory registry keyed by `id`.
4. **Inject:** For each registered theme, the loader injects a `<style>` element with rules:
   ```css
   [data-theme="<id>"] {
     --font-sans: ...;
     --background: ...;
     /* ... */
   }
   [data-theme="<id>"].dark {
     --background: ...;
     /* ... */
   }
   ```
5. **Activate:** When the user selects a theme, the app sets `document.documentElement.dataset.theme = id` and toggles the `.dark` class based on the color mode preference. CSS variables cascade everywhere automatically.
6. **Persist:** Selected theme `id` and color mode are saved (SQLite settings table — see ARCHITECTURE.md when written).

---

## Built-in themes (shipping with v1)

The following themes port over from Astra CLI (Tauri build):

1. **Perpetuity** — monospace terminal aesthetic, teal-on-deep-blue dark
2. **Cosmic Night** — deep space purples and blues
3. **Vercel** — clean black-and-white minimal
4. **Ocean Breeze** — calm teal and blue tones
5. **Cyberpunk** — high-contrast neon
6. **Cyber Wave** — synthwave magentas

All six are converted from the existing CSS files in `astra-cli/packages/tauri/src/styles/themes/*.css` into the JSON format above. The conversion is mechanical (extract each `--var` value into the `light` / `dark` object).

---

## Validation rules (summary)

A theme is **rejected** if any of the following are true:
- `id` is missing, empty, or doesn't match `^[a-z][a-z0-9-]*$`
- `label` is missing or empty
- `light` or `dark` is missing
- Any required color token is missing in `light` or `dark`
- A color value is empty or not a string
- `id` collides with another already-loaded theme **of the same source** (built-in vs user). User-vs-built-in collisions are an explicit override, not an error.

A theme is **accepted with warnings** if:
- `tokens` contains unknown keys (preserved but unused)
- A required color value is technically a string but doesn't parse as a CSS color — applied as-is; browser fallback rules kick in

---

## Authoring a theme (user-facing)

1. Copy any built-in theme JSON from `src/themes/builtin/*.json` (or from another user's shared file) as a starting point.
2. Save it as `<your-id>.json` in the user themes directory (`app_data_dir()/themes/` — see § "Where themes live" for the platform-specific path).
3. Edit colors. The picker updates live as you save.
4. Share by sending the file.

Future: an in-app theme editor that writes to the same directory. Out of scope for v1.

---

## Open questions (to resolve when implementing)

- **Theme preview swatches in the picker** — derived from `primary` + `background` + `accent`, or explicit `preview` array in the JSON? Lean toward derived to keep the format minimal.
- **System color mode follow** — should color mode default to following the OS (`prefers-color-scheme`) or always start in dark? Lean toward following OS.
- **Per-theme color mode lock** — should a theme be able to declare itself "dark-only" or "light-only"? Possibly via `modes: ["dark"]` in the JSON. Defer until a real use case appears.
