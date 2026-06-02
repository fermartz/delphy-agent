import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/core/settings/defaults";
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
  const onMainProviderModelChange = vi.fn();
  const onAuxiliaryProviderModelChange = vi.fn();
  const onThemeChange = vi.fn();
  const onColorModeChange = vi.fn();
  render(
    <SettingsModal
      open
      onOpenChange={onOpenChange}
      settings={DEFAULT_SETTINGS}
      currentMainProvider="anthropic"
      currentModel="claude-sonnet-4-6"
      currentAuxiliaryProvider="anthropic"
      currentAuxiliaryModel="claude-haiku-4-5"
      themes={fakeThemes}
      selectedThemeId="perpetuity"
      colorMode="dark"
      mcpStatuses={[]}
      mcpConfigs={[]}
      providerProfiles={[]}
      providerStates={{}}
      providerEditId={null}
      providerSaving={false}
      resolveApiKey={vi.fn(async () => null)}
      onProviderEdit={vi.fn()}
      onProviderSave={vi.fn()}
      onProviderTest={vi.fn()}
      onProviderRemove={vi.fn()}
      onMainProviderModelChange={onMainProviderModelChange}
      onAuxiliaryProviderModelChange={onAuxiliaryProviderModelChange}
      onThemeChange={onThemeChange}
      onColorModeChange={onColorModeChange}
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
    onMainProviderModelChange,
    onAuxiliaryProviderModelChange,
    onThemeChange,
    onColorModeChange,
  };
}

// Settings is now tabbed (Providers · Models · Plugins · Appearance); inactive
// tab content is not in the DOM. Helper activates a tab before asserting.
async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByRole("tab", { name }));
}

describe("SettingsModal", () => {
  it("renders the dialog with title and the four tabs", () => {
    renderModal();
    expect(screen.getByRole("dialog", { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /providers/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /models/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /plugins/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /appearance/i })).toBeInTheDocument();
  });

  it("Appearance tab shows the theme trigger and color-mode radios", async () => {
    const user = userEvent.setup();
    renderModal();
    await openTab(user, /appearance/i);
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("Models tab renders the Main + Auxiliary (Provider, Model) picker pairs", async () => {
    const user = userEvent.setup();
    renderModal();
    await openTab(user, /models/i);
    expect(screen.getByLabelText(/main provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^main model$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auxiliary provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^auxiliary model$/i)).toBeInTheDocument();
  });

  it("changing the theme Select fires onThemeChange with the new id", async () => {
    const user = userEvent.setup();
    const { onThemeChange } = renderModal();
    await openTab(user, /appearance/i);

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

  it("renders the MCP servers section with id, status badge, and tool count for each entry", async () => {
    const user = userEvent.setup();
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
    await openTab(user, /plugins/i);
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
    await openTab(user, /plugins/i);
    await user.click(screen.getByText("Add server"));
    expect(screen.getByText("Add MCP server")).toBeInTheDocument();
    expect(screen.getByLabelText(/ID \(lowercase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^command$/i)).toBeInTheDocument();
  });

  it("form validates required fields and shows errors", async () => {
    const user = userEvent.setup();
    renderModal();
    await openTab(user, /plugins/i);
    await user.click(screen.getByText("Add server"));
    await user.click(screen.getByText("Add"));
    expect(screen.getByText(/id must be/i)).toBeInTheDocument();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/command is required/i)).toBeInTheDocument();
  });

  it("form rejects inline API keys in env", async () => {
    const user = userEvent.setup();
    renderModal();
    await openTab(user, /plugins/i);
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
    await openTab(user, /plugins/i);
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

  it("disables text correction on MCP technical fields", async () => {
    const user = userEvent.setup();
    renderModal();
    await openTab(user, /plugins/i);
    await user.click(screen.getByText("Add server"));

    for (const field of [
      screen.getByLabelText(/^id/i),
      screen.getByLabelText(/^command$/i),
      screen.getByLabelText(/args/i),
      screen.getByLabelText(/environment/i),
    ]) {
      expect(field).toHaveAttribute("autocapitalize", "none");
      expect(field).toHaveAttribute("autocorrect", "off");
      expect(field).toHaveAttribute("spellcheck", "false");
    }
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
    await openTab(user, /plugins/i);
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
    await openTab(user, /plugins/i);
    await user.click(screen.getByTitle("Remove"));
    expect(screen.getByText(/remove "test-server"/i)).toBeInTheDocument();
    await user.click(screen.getByText("Confirm"));
    expect(onMcpRemove).toHaveBeenCalledWith("test-server");
  });

  it("non-stdio servers show remove only, no edit or restart", async () => {
    const user = userEvent.setup();
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
    await openTab(user, /plugins/i);
    expect(screen.getByTitle("Remove")).toBeInTheDocument();
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Restart")).not.toBeInTheDocument();
  });

  it("transport selector reveals the URL field and saves an http config", async () => {
    const user = userEvent.setup();
    const onMcpAdd = vi.fn();
    renderModal({ onMcpAdd });
    await openTab(user, /plugins/i);
    await user.click(screen.getByText("Add server"));
    // Switch transport stdio -> http.
    await user.click(screen.getByLabelText(/transport/i));
    await user.click(await screen.findByRole("option", { name: /http/i }));
    // Command field is replaced by a URL field.
    expect(screen.queryByLabelText(/^command$/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^id/i), "remote-srv");
    await user.type(screen.getByLabelText(/name/i), "Remote");
    await user.type(screen.getByLabelText(/^url$/i), "https://example.com/mcp");
    await user.click(screen.getByText("Add"));
    expect(onMcpAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "remote-srv",
        transport: "http",
        url: "https://example.com/mcp",
      }),
    );
  });

  it("http transport with no URL surfaces the url error (previously swallowed)", async () => {
    const user = userEvent.setup();
    renderModal();
    await openTab(user, /plugins/i);
    await user.click(screen.getByText("Add server"));
    await user.click(screen.getByLabelText(/transport/i));
    await user.click(await screen.findByRole("option", { name: /http/i }));
    await user.type(screen.getByLabelText(/^id/i), "remote-srv");
    await user.type(screen.getByLabelText(/name/i), "Remote");
    await user.click(screen.getByText("Add"));
    expect(screen.getByText(/url is required/i)).toBeInTheDocument();
  });

  it("shows '(unavailable)' for a selected theme that's no longer in the registry", async () => {
    // Live-watcher case: user deleted their custom theme JSON while it was
    // active. `themes` is still non-empty (builtins survive) but the active
    // selected_theme is gone. The Select must still render with that value
    // visible — not an empty trigger.
    const user = userEvent.setup();
    renderModal({ selectedThemeId: "ghost-theme" });
    await openTab(user, /appearance/i);
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
