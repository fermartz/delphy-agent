import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBar } from "./status-bar";

describe("StatusBar", () => {
  it("renders brand, model, and activity", () => {
    render(
      <StatusBar
        brand="delphy-agent"
        model="claude-sonnet-4-6"
        activity="Ready"
        commandHints={["/help"]}
      />,
    );
    expect(screen.getByText("delphy-agent")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("does NOT render token cell when totals are zero", () => {
    render(
      <StatusBar
        brand="x"
        model="m"
        activity="Ready"
        commandHints={[]}
        tokens={{ in: 0, out: 0 }}
      />,
    );
    expect(screen.queryByText(/in/)).not.toBeInTheDocument();
  });

  it("renders token cell when totals are non-zero", () => {
    render(
      <StatusBar
        brand="x"
        model="m"
        activity="Ready"
        commandHints={[]}
        tokens={{ in: 1234, out: 567 }}
      />,
    );
    expect(screen.getByText(/1.2K in/)).toBeInTheDocument();
    expect(screen.getByText(/567 out/)).toBeInTheDocument();
  });

  it("renders ctx % with no tint below 75%", () => {
    render(
      <StatusBar brand="x" model="m" activity="Ready" commandHints={[]} contextPercent={0.5} />,
    );
    const ctx = screen.getByText(/50% ctx/);
    expect(ctx).toBeInTheDocument();
    expect(ctx.className).not.toMatch(/text-yellow/);
    expect(ctx.className).not.toMatch(/text-destructive/);
  });

  it("tints ctx % yellow at 75-84%", () => {
    render(
      <StatusBar brand="x" model="m" activity="Ready" commandHints={[]} contextPercent={0.8} />,
    );
    const ctx = screen.getByText(/80% ctx/);
    expect(ctx.className).toMatch(/text-yellow-500/);
  });

  it("tints ctx % destructive at 85%+", () => {
    render(
      <StatusBar brand="x" model="m" activity="Ready" commandHints={[]} contextPercent={0.9} />,
    );
    const ctx = screen.getByText(/90% ctx/);
    expect(ctx.className).toMatch(/text-destructive/);
  });
});
