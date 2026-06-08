import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BootBanner } from "./boot-banner";

const baseProps = {
  errorMessage: "",
  keyInput: "",
  setKeyInput: vi.fn(),
  onSave: vi.fn(),
  onRetry: vi.fn(),
  onOpenProviders: vi.fn(),
  saving: false,
  providerLabel: "Anthropic",
};

describe("BootBanner", () => {
  describe("unknown error", () => {
    it("shows the failure copy and fires onRetry on Try again", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      render(
        <BootBanner {...baseProps} errorKind="unknown" errorMessage="boom" onRetry={onRetry} />,
      );
      expect(screen.getByText("Backend failed to start.")).toBeInTheDocument();
      expect(screen.getByText("boom")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledOnce();
    });
  });

  describe("missing-key (keychain)", () => {
    it("labels the provider, disables Save when empty, and fires onSave when filled", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      const { rerender } = render(
        <BootBanner {...baseProps} errorKind="missing-key" keyInput="" onSave={onSave} />,
      );
      expect(screen.getByText("Anthropic API key needed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      rerender(
        <BootBanner {...baseProps} errorKind="missing-key" keyInput="sk-123" onSave={onSave} />,
      );
      const save = screen.getByRole("button", { name: "Save" });
      expect(save).toBeEnabled();
      await user.click(save);
      expect(onSave).toHaveBeenCalledOnce();
    });

    it("offers Open Providers and fires onOpenProviders", async () => {
      const user = userEvent.setup();
      const onOpenProviders = vi.fn();
      render(
        <BootBanner {...baseProps} errorKind="missing-key" onOpenProviders={onOpenProviders} />,
      );
      await user.click(screen.getByRole("button", { name: "Open Providers" }));
      expect(onOpenProviders).toHaveBeenCalledOnce();
    });
  });

  describe("secure-storage-unavailable (Linux fallback)", () => {
    it("shows the Linux copy, a 'Use for session' button, and no Open Providers", () => {
      render(<BootBanner {...baseProps} errorKind="secure-storage-unavailable" keyInput="sk-1" />);
      expect(
        screen.getByText(/Secure storage unavailable — session-only key required/),
      ).toBeInTheDocument();
      expect(screen.getByText(/No Secret Service daemon/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use for session" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Open Providers" })).not.toBeInTheDocument();
    });
  });
});
