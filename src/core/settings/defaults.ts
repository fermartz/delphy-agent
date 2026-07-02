import { SCHEMA_URL, type Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  $schema: SCHEMA_URL,
  selected_theme: "perpetuity",
  color_mode: "system",
  default_backend: "anthropic-api",
  main_provider: null,
  main_model: null,
  auxiliary_provider: null,
  auxiliary_model: null,
  openai_compatible_base_url: null,
  codex_working_dir: null,
  trusted_image_hosts: [],
};
