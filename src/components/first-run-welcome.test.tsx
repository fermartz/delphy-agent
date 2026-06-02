import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "@/core/providers/types";
import { FirstRunWelcome } from "./first-run-welcome";

const fakeProfile = (id: string, label: string): ProviderProfile =>
  ({
    id,
    label,
    secretKey: `${id}_api_key`,
    defaultModel: `${id}-flagship`,
    model: vi.fn(),
    curatedModels: [`${id}-flagship`],
    pricing: {},
    discoveryFingerprint: () => "fp",
  }) as unknown as ProviderProfile;

const profiles = [fakeProfile("anthropic", "Anthropic"), fakeProfile("openai", "OpenAI")];

beforeEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: jsdom polyfill
  (HTMLElement.prototype as any).scrollIntoView = vi.fn();
});

describe("FirstRunWelcome", () => {
  it("renders one button per profile", () => {
    render(
      <FirstRunWelcome
        open
        profiles={profiles}
        preselectId={null}
        hasAnyKey={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Anthropic/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /OpenAI/i })).toBeInTheDocument();
  });

  it("shows the 'add a key' copy when no keys are configured", () => {
    render(
      <FirstRunWelcome
        open
        profiles={profiles}
        preselectId={null}
        hasAnyKey={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/add an API key in the next step/i)).toBeInTheDocument();
  });

  it("shows the existing-key copy + (key configured) badge when a key exists", () => {
    render(
      <FirstRunWelcome
        open
        profiles={profiles}
        preselectId="anthropic"
        hasAnyKey
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/use your existing key/i)).toBeInTheDocument();
    expect(screen.getByText(/\(key configured\)/i)).toBeInTheDocument();
  });

  it("fires onSelect with the provider id when a button is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FirstRunWelcome
        open
        profiles={profiles}
        preselectId={null}
        hasAnyKey={false}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button", { name: /OpenAI/i }));
    expect(onSelect).toHaveBeenCalledWith("openai");
  });
});
