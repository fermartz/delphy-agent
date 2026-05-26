import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatIcon, type ChatIconInput } from "./chat-icon";

function renderIcon(item: ChatIconInput) {
  const { container } = render(<ChatIcon item={item} />);
  return container;
}

describe("ChatIcon", () => {
  it("user-text renders an empty spacer (no icon)", () => {
    const c = renderIcon({ kind: "user-text" });
    // No svg in the user-text branch — just an aria-hidden spacer span.
    expect(c.querySelector("svg")).toBeNull();
  });

  it("assistant-text renders AgentAvatar (svg with fill-primary classes)", () => {
    const c = renderIcon({ kind: "assistant-text" });
    const svg = c.querySelector("svg");
    expect(svg).not.toBeNull();
    // AgentAvatar uses two fill-primary rects/circles for outer frame + eyes.
    expect(c.querySelectorAll(".fill-primary").length).toBeGreaterThanOrEqual(2);
    // And fill-background for the inner face.
    expect(c.querySelector(".fill-background")).not.toBeNull();
  });

  it("system (info / default) renders Info icon with text-primary", () => {
    const c = renderIcon({ kind: "system", intent: "info" });
    const svg = c.querySelector("svg.lucide-info");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("text-primary")).toBe(true);
  });

  it("system (no intent) defaults to Info", () => {
    const c = renderIcon({ kind: "system" });
    expect(c.querySelector("svg.lucide-info")).not.toBeNull();
  });

  it("system (error intent) renders AlertTriangle with text-primary (not destructive)", () => {
    const c = renderIcon({ kind: "system", intent: "error" });
    const svg = c.querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle");
    expect(svg).not.toBeNull();
    // text-primary, NOT text-destructive — that's Astra's intentional pattern.
    expect(svg?.classList.contains("text-primary")).toBe(true);
    expect(svg?.classList.contains("text-destructive")).toBe(false);
  });

  it("tool-call renders Loader2 with animate-spin and muted color", () => {
    const c = renderIcon({ kind: "tool-call" });
    const svg = c.querySelector(
      "svg.lucide-loader-circle, svg.lucide-loader-2, svg.lucide-loader2",
    );
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("animate-spin")).toBe(true);
    expect(svg?.classList.contains("text-muted-foreground")).toBe(true);
  });

  it("tool-result success renders CheckCircle2 with text-primary", () => {
    const c = renderIcon({ kind: "tool-result", isError: false });
    const svg = c.querySelector(
      "svg.lucide-circle-check, svg.lucide-circle-check-big, svg.lucide-check-circle-2",
    );
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("text-primary")).toBe(true);
  });

  it("tool-result error renders XCircle with text-destructive (semantic red)", () => {
    const c = renderIcon({ kind: "tool-result", isError: true });
    const svg = c.querySelector("svg.lucide-circle-x, svg.lucide-x-circle");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("text-destructive")).toBe(true);
  });

  it("approval renders Shield with text-primary", () => {
    const c = renderIcon({ kind: "approval" });
    expect(c.querySelector("svg.lucide-shield")).not.toBeNull();
    const svg = c.querySelector("svg.lucide-shield");
    expect(svg?.classList.contains("text-primary")).toBe(true);
  });

  it("runtime-error renders AlertCircle with text-destructive (semantic red)", () => {
    const c = renderIcon({ kind: "runtime-error" });
    const svg = c.querySelector("svg.lucide-circle-alert, svg.lucide-alert-circle");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("text-destructive")).toBe(true);
  });
});
