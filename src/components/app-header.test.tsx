import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Theme } from "@/themes/types";
import { AppHeader } from "./app-header";

const themes = [
  { id: "perpetuity", label: "Perpetuity" },
  { id: "cyberpunk", label: "Cyberpunk" },
] as unknown as Theme[];

function renderHeader(overrides: Partial<Parameters<typeof AppHeader>[0]> = {}) {
  const props = {
    themes,
    selectedThemeId: "perpetuity",
    onThemeChange: vi.fn(),
    colorMode: "light" as const,
    onColorModeChange: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<AppHeader {...props} />);
  return props;
}

describe("AppHeader", () => {
  it("renders the brand and the current theme label", () => {
    renderHeader();
    expect(screen.getByRole("heading", { name: "Delphy Agent" })).toBeInTheDocument();
    expect(screen.getByText("Perpetuity")).toBeInTheDocument();
  });

  it("fires onOpenSettings when the gear is clicked", async () => {
    const user = userEvent.setup();
    const { onOpenSettings } = renderHeader();
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("fires onColorModeChange (light -> dark) when the color-mode toggle is clicked", async () => {
    const user = userEvent.setup();
    const { onColorModeChange } = renderHeader({ colorMode: "light" });
    await user.click(screen.getByRole("button", { name: /Light mode/i }));
    expect(onColorModeChange).toHaveBeenCalledWith("dark");
  });

  it("fires onThemeChange with the selected theme id", async () => {
    const user = userEvent.setup();
    const { onThemeChange } = renderHeader();
    await user.click(screen.getByRole("button", { name: /Perpetuity/i }));
    await user.click(screen.getByRole("menuitem", { name: /Cyberpunk/i }));
    expect(onThemeChange).toHaveBeenCalledWith("cyberpunk");
  });
});
