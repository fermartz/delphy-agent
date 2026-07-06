import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/mcp/manager", () => ({
  mcpManager: {
    init: vi.fn(async () => {}),
    getStatus: vi.fn(() => []),
    addServer: vi.fn(async () => {}),
    removeServer: vi.fn(async () => {}),
    restartServer: vi.fn(async () => {}),
    setDisabledTools: vi.fn(),
    getServerTools: vi.fn(() => []),
  },
}));
vi.mock("@/core/mcp/store", () => ({
  loadMcpConfigs: vi.fn(async () => []),
  saveMcpConfigs: vi.fn(async () => {}),
}));

import { mcpManager } from "@/core/mcp/manager";
import { loadMcpConfigs, saveMcpConfigs } from "@/core/mcp/store";
import type { McpServerConfig, McpServerStatus } from "@/core/mcp/types";
import { reconcileStatuses, useMcpServers } from "./use-mcp-servers";

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

describe("useMcpServers — handleMcpToolToggle (BACKLOG #18)", () => {
  const SRV: McpServerConfig = {
    id: "srv",
    name: "Srv",
    enabled: true,
    transport: "stdio",
    command: "echo",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadMcpConfigs).mockResolvedValue([SRV]);
    vi.mocked(mcpManager.getStatus).mockReturnValue([]);
  });

  async function mountHook() {
    const view = renderHook(() => useMcpServers({ onToast: vi.fn() }));
    await waitFor(() => expect(view.result.current.mcpConfigs).toHaveLength(1));
    return view;
  }

  it("disabling a tool persists disabledTools and applies it without restarting", async () => {
    const { result } = await mountHook();

    await act(() => result.current.handleMcpToolToggle("srv", "zeta", false));

    expect(vi.mocked(saveMcpConfigs)).toHaveBeenCalledWith([{ ...SRV, disabledTools: ["zeta"] }]);
    expect(vi.mocked(mcpManager.setDisabledTools)).toHaveBeenCalledWith("srv", ["zeta"]);
    // The no-restart guarantee: a tool toggle is a read-time filter.
    expect(vi.mocked(mcpManager.restartServer)).not.toHaveBeenCalled();
    expect(vi.mocked(mcpManager.addServer)).not.toHaveBeenCalled();
    expect(vi.mocked(mcpManager.removeServer)).not.toHaveBeenCalled();
    expect(result.current.mcpConfigs[0].disabledTools).toEqual(["zeta"]);
  });

  it("re-enabling the last disabled tool clears disabledTools back to undefined", async () => {
    vi.mocked(loadMcpConfigs).mockResolvedValue([{ ...SRV, disabledTools: ["zeta"] }]);
    const { result } = await mountHook();

    await act(() => result.current.handleMcpToolToggle("srv", "zeta", true));

    expect(vi.mocked(saveMcpConfigs)).toHaveBeenCalledWith([{ ...SRV, disabledTools: undefined }]);
    expect(vi.mocked(mcpManager.setDisabledTools)).toHaveBeenCalledWith("srv", undefined);
  });

  it("keeps the disabled list sorted when adding to an existing list", async () => {
    vi.mocked(loadMcpConfigs).mockResolvedValue([{ ...SRV, disabledTools: ["zeta"] }]);
    const { result } = await mountHook();

    await act(() => result.current.handleMcpToolToggle("srv", "alpha", false));

    expect(vi.mocked(mcpManager.setDisabledTools)).toHaveBeenCalledWith("srv", ["alpha", "zeta"]);
  });

  it("is a no-op for an unknown server id", async () => {
    const { result } = await mountHook();

    await act(() => result.current.handleMcpToolToggle("nope", "tool", false));

    expect(vi.mocked(saveMcpConfigs)).not.toHaveBeenCalled();
    expect(vi.mocked(mcpManager.setDisabledTools)).not.toHaveBeenCalled();
  });
});
