export const SCHEMA_URL = "https://delphy.app/schemas/settings/v1.json";

export type ColorMode = "light" | "dark" | "system";

export interface Settings {
  $schema: string;
  selected_theme: string;
  color_mode: ColorMode;
  default_backend: string;
  main_model: string;
  auxiliary_model: string;
}
