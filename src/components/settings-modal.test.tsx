import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Theme } from "@/themes/types";
import { SettingsModal } from "./settings-modal";

// Radix Select / DropdownMenu use ResizeObserver + scrollIntoView, neither of
// which jsdom implements. Stub them globally for the test file.
if (!("ResizeObserver" in globalThis)) {
  // biome-ignore lint/suspicious/noExplicitAny: jsdom stub
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}
// jsdom doesn't implement PointerEvent or the related capture APIs that Radix
// uses to manage focus inside SelectContent. Provide minimal no-op stubs so
// userEvent.click on a Select trigger doesn't crash.
if (!HTMLElement.prototype.hasPointerCapture) {
  // biome-ignore lint/suspicious/noExplicitAny: jsdom stub
  (HTMLElement.prototype as any).hasPointerCapture = () => false;
}
if (!HTMLElement.prototype.releasePointerCapture) {
  // biome-ignore lint/suspicious/noExplicitAny: jsdom stub
  (HTMLElement.prototype as any).releasePointerCapture = () => {};
}

const fakeThemes: Theme[] = [
  // biome-ignore lint/suspicious/noExplicitAny: minimal theme fixture; smoke test ignores token fields
  { id: "perpetuity", label: "Perpetuity" } as any,
  // biome-ignore lint/suspicious/noExplicitAny: minimal theme fixture
  { id: "cyberpunk", label: "Cyberpunk" } as any,
];

function renderModal(overrides: Partial<React.ComponentProps<typeof SettingsModal>> = {}) {
  const onOpenChange = vi.fn();
  const onSelectModel = vi.fn();
  const onSelectAuxiliaryModel = vi.fn();
  const onThemeChange = vi.fn();
  const onColorModeChange = vi.fn();
  const onRetry = vi.fn();
  render(
    <SettingsModal
      open
      onOpenChange={onOpenChange}
      currentModel="claude-sonnet-4-6"
      currentAuxiliaryModel="claude-haiku-4-5"
      availableModels={["claude-sonnet-4-6", "claude-haiku-4-5"]}
      modelsLoading={false}
      modelsError={null}
      themes={fakeThemes}
      selectedThemeId="perpetuity"
      colorMode="dark"
      mcpStatuses={[]}
      mcpConfigs={[]}
      onSelectModel={onSelectModel}
      onSelectAuxiliaryModel={onSelectAuxiliaryModel}
      onThemeChange={onThemeChange}
      onColorModeChange={onColorModeChange}
      onRetry={onRetry}
      onMcpAdd={vi.fn()}
      onMcpEdit={vi.fn()}
      onMcpRemove={vi.fn()}
      onMcpRestart={vi.fn()}
      onMcpToggle={vi.fn()}
      {...overrides}
    />,
  );
  return {
    onOpenChange,
    onSelectModel,
    onSelectAuxiliaryModel,
    onThemeChange,
    onColorModeChange,
    onRetry,
  };
}

describe("SettingsModal", () => {
  it("renders the dialog with title, theme trigger, main + auxiliary model triggers, and color-mode radios", () => {
    renderModal();
    expect(screen.getByRole("dialog", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^main model$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^auxiliary model$/i)).toBeInTheDocument();
    // 3 color-mode radios (one per mode)
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("changing the Auxiliary model Select fires onSelectAuxiliaryModel with the new id", async () => {
    const user = userEvent.setup();
    const { onSelectAuxiliaryModel } = renderModal();

    const auxTrigger = screen.getByLabelText(/^auxiliary model$/i);
    await user.click(auxTrigger);
    // The other available model ("claude-sonnet-4-6") appears as an option in
    // the auxiliary picker — pick it (different from the default current value
    // "claude-haiku-4-5" so we exercise the change path). Radix renders only
    // the active SelectContent's options, so findByRole (singular) is unique.
    const sonnetOption = await screen.findByRole("option", { name: /claude-sonnet-4-6/i });
    await user.click(sonnetOption);

    await waitFor(() => {
      expect(onSelectAuxiliaryModel).toHaveBeenCalledWith("claude-sonnet-4-6");
    });
  });

  it("changing the theme Select fires onThemeChange with the new id", async () => {
    const user = userEvent.setup();
    const { onThemeChange } = renderModal();

    // Open the theme Select
    const themeTrigger = screen.getByLabelText(/theme/i);
    await user.click(themeTrigger);
    // The "Cyberpunk" option appears in the now-open SelectContent
    const cyberpunkOption = await screen.findByRole("option", { name: /cyberpunk/i });
    await user.click(cyberpunkOption);

    await waitFor(() => {
      expect(onThemeChange).toHaveBeenCalledWith("cyberpunk");
    });
  });

  it("Escape closes the dialog by firing onOpenChange(false)", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderModal();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("renders the MCP servers section with id, status badge, and tool count for each entry", () => {
    renderModal({
      mcpStatuses: [
        { id: "server-everything", name: "Everything", kind: "connected", toolCount: 13 },
        { id: "broken-one", name: "Broken", kind: "failed", error: "SPAWN_FAILED: nope" },
      ],
      mcpConfigs: [
        {
          id: "server-everything",
          name: "Everything",
          enabled: true,
          transport: "stdio",
          command: "npx",
        },
        { id: "broken-one", name: "Broken", enabled: true, transport: "stdio", command: "bad" },
      ],
    });
    expect(screen.getByText("server-everything")).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.getByText("(13 tools)")).toBeInTheDocument();
    expect(screen.getByText("broken-one")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText(/SPAWN_FAILED: nope/)).toBeInTheDocument();
  });

  it("Add server button opens the form", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText("Add server"));
    expect(screen.getByText("Add MCP server")).toBeInTheDocument();
    expect(screen.getByLabelText(/id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/command/i)).toBeInTheDocument();
  });

  it("form validates required fields and shows errors", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText("Add server"));
    await user.click(screen.getByText("Add"));
    expect(screen.getByText(/id must be/i)).toBeInTheDocument();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/command is required/i)).toBeInTheDocument();
  });

  it("form rejects inline API keys in env", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText("Add server"));
    await user.type(screen.getByLabelText(/^id/i), "test");
    await user.type(screen.getByLabelText(/name/i), "Test");
    await user.type(screen.getByLabelText(/command/i), "echo");
    await user.type(screen.getByLabelText(/environment/i), "KEY=sk-ant-abc123");
    await user.click(screen.getByText("Add"));
    expect(screen.getByText(/inline api keys are not allowed/i)).toBeInTheDocument();
  });

  it("form calls onMcpAdd with valid config", async () => {
    const user = userEvent.setup();
    const onMcpAdd = vi.fn();
    renderModal({ onMcpAdd });
    await user.click(screen.getByText("Add server"));
    await user.type(screen.getByLabelText(/^id/i), "my-server");
    await user.type(screen.getByLabelText(/name/i), "My Server");
    await user.type(screen.getByLabelText(/command/i), "node");
    await user.type(screen.getByLabelText(/args/i), "server.js --port 3000");
    await user.click(screen.getByText("Add"));
    expect(onMcpAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "my-server",
        name: "My Server",
        command: "node",
        args: ["server.js", "--port", "3000"],
        transport: "stdio",
        enabled: true,
      }),
    );
  });

  it("edit button opens pre-filled form for stdio servers", async () => {
    const user = userEvent.setup();
    renderModal({
      mcpStatuses: [{ id: "test-server", name: "Test", kind: "connected", toolCount: 2 }],
      mcpConfigs: [
        {
          id: "test-server",
          name: "Test",
          enabled: true,
          transport: "stdio",
          command: "echo",
          args: ["hi"],
        },
      ],
    });
    await user.click(screen.getByTitle("Edit"));
    expect(screen.getByText("Edit server")).toBeInTheDocument();
    expect(screen.getByLabelText(/^id/i)).toHaveValue("test-server");
    expect(screen.getByLabelText(/command/i)).toHaveValue("echo");
  });

  it("remove button shows confirmation", async () => {
    const user = userEvent.setup();
    const onMcpRemove = vi.fn();
    renderModal({
      mcpStatuses: [{ id: "test-server", name: "Test", kind: "connected", toolCount: 2 }],
      mcpConfigs: [
        { id: "test-server", name: "Test", enabled: true, transport: "stdio", command: "echo" },
      ],
      onMcpRemove,
    });
    await user.click(screen.getByTitle("Remove"));
    expect(screen.getByText(/remove "test-server"/i)).toBeInTheDocument();
    await user.click(screen.getByText("Confirm"));
    expect(onMcpRemove).toHaveBeenCalledWith("test-server");
  });

  it("non-stdio servers show remove only, no edit or restart", () => {
    renderModal({
      mcpStatuses: [
        {
          id: "http-server",
          name: "HTTP",
          kind: "failed",
          error: 'Transport "http" is not yet supported',
        },
      ],
      mcpConfigs: [
        {
          id: "http-server",
          name: "HTTP",
          enabled: true,
          transport: "http",
          url: "https://example.com",
        },
      ],
    });
    expect(screen.getByTitle("Remove")).toBeInTheDocument();
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Restart")).not.toBeInTheDocument();
  });

  it("shows '(unavailable)' for a selected theme that's no longer in the registry", async () => {
    // Live-watcher case: user deleted their custom theme JSON while it was
    // active. `themes` is still non-empty (builtins survive) but the active
    // selected_theme is gone. The Select must still render with that value
    // visible — not an empty trigger.
    const user = userEvent.setup();
    renderModal({ selectedThemeId: "ghost-theme" });
    const themeTrigger = screen.getByLabelText(/theme/i);
    // The trigger shows the synthetic label, so the controlled value matches an item.
    expect(themeTrigger).toHaveTextContent(/ghost-theme \(unavailable\)/i);
    // Opening the Select reveals the synthetic option alongside the loaded themes.
    await user.click(themeTrigger);
    expect(
      await screen.findByRole("option", { name: /ghost-theme \(unavailable\)/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /perpetuity/i })).toBeInTheDocument();
  });
});
