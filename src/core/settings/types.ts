export const SCHEMA_URL = "https://delphy.app/schemas/settings/v1.json";

export type ColorMode = "light" | "dark" | "system";

export interface Settings {
  $schema: string;
  selected_theme: string;
  color_mode: ColorMode;
  default_backend: string;
  // Null on all four = "use default behavior" per Parameter 10a of the
  // multi-provider plan: main_provider=null fires First-Run Welcome;
  // main_model=null falls back to the active profile's defaultModel;
  // auxiliary_provider=null falls back to main_provider; auxiliary_model=null
  // falls back to the resolved auxiliary profile's defaultModel.
  main_provider: string | null;
  main_model: string | null;
  auxiliary_provider: string | null;
  auxiliary_model: string | null;
  // Base URL for the Custom OpenAI-compatible profile. Empty/null = unset.
  openai_compatible_base_url: string | null;
  // Working directory for the Codex backend (agent-cli). Null = unset; the
  // Codex backend won't start without it. Validation/UI land in CP4.
  codex_working_dir: string | null;
  // Hosts the user has chosen to auto-load remote images from in rendered
  // markdown. Empty by default: remote images are blocked until the user loads
  // them (per-image) or trusts the host. Stored normalized (lowercase host).
  trusted_image_hosts: string[];
}
