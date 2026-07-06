import { useCallback, useEffect, useState } from "react";
import { mcpManager } from "@/core/mcp/manager";
import { loadMcpConfigs, saveMcpConfigs } from "@/core/mcp/store";
import type { McpServerConfig, McpServerStatus } from "@/core/mcp/types";

/**
 * Merge the manager's statuses into the visible map WITHOUT dropping rows the
 * manager hasn't recorded yet (other in-flight optimistic "connecting" rows).
 * `force` pins one row — used to synthesize a failed row when a step before
 * bootOne threw (e.g. persistence), so the server never silently vanishes.
 *
 * Extracted as a pure function so the non-clobbering merge is unit-testable.
 */
export function reconcileStatuses(
  prev: McpServerStatus[],
  managed: McpServerStatus[],
  force?: McpServerStatus,
): McpServerStatus[] {
  const byId = new Map(managed.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const next = prev.map((s) => {
    seen.add(s.id);
    if (force && s.id === force.id) return force;
    return byId.get(s.id) ?? s;
  });
  for (const s of managed) if (!seen.has(s.id)) next.push(s);
  if (force && !seen.has(force.id)) next.push(force);
  return next;
}

interface UseMcpServersOptions {
  /** Surface a failed-connect message to the user (App owns the toast state). */
  onToast: (message: string) => void;
}

/**
 * Owns MCP server config + live status state, the mount-once boot, and the
 * add/edit/remove/restart/toggle handlers. Extracted verbatim from App.tsx;
 * returned callbacks are stable (useCallback) so memoized consumers don't
 * re-render during chat streaming.
 */
export function useMcpServers({ onToast }: UseMcpServersOptions) {
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [mcpConfigs, setMcpConfigs] = useState<McpServerConfig[]>([]);

  // Insert/replace an optimistic "connecting…" row so the user gets immediate
  // feedback while a server spawns + connects (npx cold-start can take many
  // seconds). Mirrors the boot-time placeholder pattern.
  const setMcpConnecting = useCallback((id: string, name: string) => {
    setMcpStatuses((prev) => {
      const row = { id, name, kind: "connecting" as const };
      return prev.some((s) => s.id === id)
        ? prev.map((s) => (s.id === id ? row : s))
        : [...prev, row];
    });
  }, []);

  const reconcileMcpStatuses = useCallback(
    (managed: McpServerStatus[], force?: McpServerStatus) => {
      setMcpStatuses((prev) => reconcileStatuses(prev, managed, force));
    },
    [],
  );

  // Boot MCP servers once on mount. Per slice-A plan Parameter 15, failure is
  // non-blocking: each per-server failure is captured as `kind: "failed"` in
  // McpManager state and surfaces in the Settings modal; chat works regardless.
  // Show "connecting…" rows immediately so users see progress while npx warms
  // up on first run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once boot effect; reconcileMcpStatuses is stable and must not retrigger this effect.
  useEffect(() => {
    let active = true;
    void loadMcpConfigs()
      .then((configs) => {
        if (!active) return;
        setMcpConfigs(configs);
        setMcpStatuses(
          configs.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.enabled ? ("connecting" as const) : ("disabled" as const),
          })),
        );
        return mcpManager.init(configs);
      })
      .then(() => {
        if (!active) return;
        // Merge (not wholesale-replace) so a user add/edit that started during
        // boot init — including a synthesized failed row the manager doesn't
        // know about — isn't erased by the init-completion snapshot.
        reconcileMcpStatuses(mcpManager.getStatus());
      });
    return () => {
      active = false;
    };
  }, []);

  // Run a spawn-bearing MCP action with feedback. `bootOne` never throws on a
  // connect failure — it resolves with kind:"failed" — so after the await we
  // read getStatus() and toast the failed row's error. A pre-bootOne throw
  // (e.g. persistence) means the manager has no entry for the server, so we
  // synthesize a failed row instead of letting it vanish. Statuses are merged,
  // never wholesale-replaced, so a concurrent action's optimistic row survives.
  const runMcpBoot = useCallback(
    async (config: McpServerConfig, run: () => Promise<void>) => {
      setMcpConnecting(config.id, config.name);
      let errMsg: string | null = null;
      try {
        await run();
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }
      const managed = mcpManager.getStatus();
      const known = managed.find((s) => s.id === config.id);
      const force: McpServerStatus | undefined =
        errMsg && !known
          ? { id: config.id, name: config.name, kind: "failed", error: errMsg }
          : undefined;
      reconcileMcpStatuses(managed, force);
      const finalRow = force ?? known;
      if (finalRow?.kind === "failed") {
        onToast(`MCP "${config.id}" failed — ${finalRow.error ?? errMsg ?? "could not connect"}`);
      }
    },
    [setMcpConnecting, reconcileMcpStatuses, onToast],
  );

  const handleMcpAdd = useCallback(
    async (config: McpServerConfig) => {
      const updated = [...mcpConfigs, config];
      setMcpConfigs(updated);
      await runMcpBoot(config, async () => {
        await saveMcpConfigs(updated);
        await mcpManager.addServer(config);
      });
    },
    [mcpConfigs, runMcpBoot],
  );

  const handleMcpEdit = useCallback(
    async (config: McpServerConfig) => {
      const updated = mcpConfigs.map((c) => (c.id === config.id ? config : c));
      setMcpConfigs(updated);
      await runMcpBoot(config, async () => {
        await saveMcpConfigs(updated);
        await mcpManager.restartServer(config);
      });
    },
    [mcpConfigs, runMcpBoot],
  );

  const handleMcpRemove = useCallback(
    async (id: string) => {
      const updated = mcpConfigs.filter((c) => c.id !== id);
      setMcpConfigs(updated);
      await saveMcpConfigs(updated);
      await mcpManager.removeServer(id);
      // Drop just this row; the config is gone so it won't render regardless, and
      // we avoid clobbering any other action's in-flight optimistic row.
      setMcpStatuses((prev) => prev.filter((s) => s.id !== id));
    },
    [mcpConfigs],
  );

  const handleMcpRestart = useCallback(
    async (id: string) => {
      const config = mcpConfigs.find((c) => c.id === id);
      if (!config) return;
      await runMcpBoot(config, () => mcpManager.restartServer(config));
    },
    [mcpConfigs, runMcpBoot],
  );

  const handleMcpToggle = useCallback(
    async (id: string, enabled: boolean) => {
      const updated = mcpConfigs.map((c) => (c.id === id ? { ...c, enabled } : c));
      setMcpConfigs(updated);
      const config = updated.find((c) => c.id === id);
      if (!config) return;
      if (enabled) {
        // Enable routes through the same long-running spawn path as Add.
        await runMcpBoot(config, async () => {
          await saveMcpConfigs(updated);
          await mcpManager.addServer(config);
        });
      } else {
        // Disable: stop the server immediately (no spawn). The config stays with
        // enabled:false, so the row renders as "disabled" once its status clears.
        await saveMcpConfigs(updated);
        await mcpManager.removeServer(id);
        setMcpStatuses((prev) => prev.filter((s) => s.id !== id));
      }
    },
    [mcpConfigs, runMcpBoot],
  );

  // Per-tool enable/disable (BACKLOG #18). A read-time filter: persist the
  // updated disabledTools list and apply it to the live manager entry — the
  // server itself is never restarted for a tool toggle. The manager bumps its
  // revision so the adapter's memoized tool set rebuilds on the next turn.
  const handleMcpToolToggle = useCallback(
    async (serverId: string, toolName: string, enabled: boolean) => {
      const config = mcpConfigs.find((c) => c.id === serverId);
      if (!config) return;
      const current = new Set(config.disabledTools ?? []);
      if (enabled) current.delete(toolName);
      else current.add(toolName);
      // Sorted + undefined-when-empty keeps the persisted config JSON canonical.
      const next = current.size > 0 ? [...current].sort() : undefined;
      const updated = mcpConfigs.map((c) =>
        c.id === serverId ? { ...c, disabledTools: next } : c,
      );
      setMcpConfigs(updated);
      await saveMcpConfigs(updated);
      mcpManager.setDisabledTools(serverId, next);
    },
    [mcpConfigs],
  );

  // Unfiltered tool list for the Settings UI's per-tool toggles (disabled
  // tools must stay visible to be re-enabled). Stable identity so the
  // memoized SettingsModal doesn't re-render during streaming.
  const getMcpServerTools = useCallback(
    (serverId: string) => mcpManager.getServerTools(serverId),
    [],
  );

  return {
    mcpStatuses,
    mcpConfigs,
    handleMcpAdd,
    handleMcpEdit,
    handleMcpRemove,
    handleMcpRestart,
    handleMcpToggle,
    handleMcpToolToggle,
    getMcpServerTools,
  };
}
