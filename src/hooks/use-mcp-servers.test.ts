import { describe, expect, it } from "vitest";
import type { McpServerStatus } from "@/core/mcp/types";
import { reconcileStatuses } from "./use-mcp-servers";

const connected = (id: string, toolCount = 1): McpServerStatus => ({
  id,
  name: id,
  kind: "connected",
  toolCount,
});
const connecting = (id: string): McpServerStatus => ({ id, name: id, kind: "connecting" });
const failed = (id: string, error = "boom"): McpServerStatus => ({
  id,
  name: id,
  kind: "failed",
  error,
});

describe("reconcileStatuses", () => {
  it("updates existing rows from the managed snapshot", () => {
    const prev = [connecting("a")];
    const out = reconcileStatuses(prev, [connected("a")]);
    expect(out).toEqual([connected("a")]);
  });

  it("does NOT drop a prev row the manager hasn't recorded yet (non-clobber)", () => {
    // 'b' is an in-flight optimistic connecting row the manager doesn't know about.
    const prev = [connected("a"), connecting("b")];
    const out = reconcileStatuses(prev, [connected("a")]);
    expect(out).toEqual([connected("a"), connecting("b")]);
  });

  it("appends managed rows not present in prev", () => {
    const out = reconcileStatuses([connected("a")], [connected("a"), connected("b")]);
    expect(out).toEqual([connected("a"), connected("b")]);
  });

  it("force-pins an existing row, overriding the managed value", () => {
    const prev = [connecting("a")];
    const out = reconcileStatuses(prev, [connected("a")], failed("a", "persist error"));
    expect(out).toEqual([failed("a", "persist error")]);
  });

  it("force-appends a row absent from both prev and managed", () => {
    const out = reconcileStatuses([connected("a")], [connected("a")], failed("b"));
    expect(out).toEqual([connected("a"), failed("b")]);
  });

  it("preserves order and is a no-op-shaped merge when managed mirrors prev", () => {
    const prev = [connected("a"), connected("b")];
    const out = reconcileStatuses(prev, [connected("a"), connected("b")]);
    expect(out).toEqual(prev);
  });
});
