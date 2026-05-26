export const SCHEMA_URL = "https://delphy.app/schemas/settings/v1.json";

export type ColorMode = "light" | "dark" | "system";

export interface WindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

export interface Settings {
  $schema: string;
  selected_theme: string;
  color_mode: ColorMode;
  default_backend: string;
  main_model: string;
  auxiliary_model: string;
  window_state: WindowState | null;
}
