import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ProviderRowState, ProvidersPanel } from "./providers-panel";

const fakeProfile = (id: string, label: string, secretKey: string) =>
  ({
    id,
    label,
    secretKey,
    defaultModel: `${id}-flagship`,
    model: vi.fn(),
    curatedModels: [],
    pricing: {},
    discoveryFingerprint: () => "fp",
  }) as unknown as Parameters<typeof ProvidersPanel>[0]["profiles"][number];

const anthropic = fakeProfile("anthropic", "Anthropic", "anthropic_api_key");
const openai = fakeProfile("openai", "OpenAI", "openai_api_key");

function renderPanel(
  states: Record<string, ProviderRowState> = {},
  editingId: string | null = null,
  saving = false,
) {
  const onEdit = vi.fn();
  const onSave = vi.fn();
  const onTest = vi.fn();
  const onRemove = vi.fn();
  render(
    <ProvidersPanel
      profiles={[anthropic, openai]}
      states={states}
      editingId={editingId}
      saving={saving}
      onEdit={onEdit}
      onSave={onSave}
      onTest={onTest}
      onRemove={onRemove}
    />,
  );
  return { onEdit, onSave, onTest, onRemove };
}

beforeEach(() => {
  // jsdom polyfill for some Radix interactive states.
  // biome-ignore lint/suspicious/noExplicitAny: jsdom polyfill
  (HTMLElement.prototype as any).scrollIntoView = vi.fn();
});

describe("ProvidersPanel", () => {
  it("renders a row per profile with status", () => {
    renderPanel({
      anthropic: { status: "configured", preview: "***abcd" },
      openai: { status: "not-configured" },
    });
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText(/Configured \(\*\*\*abcd\)/)).toBeInTheDocument();
    expect(screen.getByText(/Not configured/)).toBeInTheDocument();
  });

  it("Add key triggers onEdit with the provider id", async () => {
    const user = userEvent.setup();
    const { onEdit } = renderPanel({
      openai: { status: "not-configured" },
    });
    const openaiRow = screen.getByText("OpenAI").closest("li");
    if (!openaiRow) throw new Error("OpenAI row not found");
    const addBtn = openaiRow.querySelector("button");
    if (!addBtn) throw new Error("Add key button not found");
    await user.click(addBtn);
    expect(onEdit).toHaveBeenCalledWith("openai");
  });

  it("Test button triggers onTest for configured providers", async () => {
    const user = userEvent.setup();
    const { onTest } = renderPanel({
      anthropic: { status: "configured", preview: "***abcd" },
    });
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(onTest).toHaveBeenCalledWith("anthropic");
  });

  it("Remove → confirm → calls onRemove", async () => {
    const user = userEvent.setup();
    const { onRemove } = renderPanel({
      anthropic: { status: "configured", preview: "***abcd" },
    });
    // Click Remove → reveals confirmation prompt
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText(/Remove Anthropic key from keychain/)).toBeInTheDocument();
    // Click the confirmation Remove button
    const confirmBtn = screen.getAllByRole("button", { name: "Remove" }).pop();
    if (!confirmBtn) throw new Error("Confirm button missing");
    await user.click(confirmBtn);
    expect(onRemove).toHaveBeenCalledWith("anthropic");
  });

  it("shows invalid state with the test error message", () => {
    renderPanel({
      anthropic: {
        status: "invalid",
        preview: "***abcd",
        testError: "HTTP 401 Unauthorized",
      },
    });
    expect(screen.getByText("Invalid")).toBeInTheDocument();
    expect(screen.getByText("HTTP 401 Unauthorized")).toBeInTheDocument();
  });

  it("renders inline ApiKeyInput when editingId matches", () => {
    renderPanel({ anthropic: { status: "not-configured" } }, "anthropic", false);
    expect(screen.getByPlaceholderText("sk-ant-...")).toBeInTheDocument();
  });
});
