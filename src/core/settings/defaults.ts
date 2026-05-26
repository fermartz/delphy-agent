import { anthropicProfile } from "../providers/anthropic";
import { SCHEMA_URL, type Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  $schema: SCHEMA_URL,
  selected_theme: "perpetuity",
  color_mode: "system",
  default_backend: "anthropic-api",
  main_model: anthropicProfile.defaultModel,
  auxiliary_model: "claude-haiku-4-5",
  window_state: null,
};
