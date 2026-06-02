import { getProvider } from "../providers";
import type { ProviderPricing } from "../providers/types";
import type { Command, CommandResult, StatusSnapshot } from "./types";

function formatTokens(n: number): string {
  return n.toLocaleString();
}

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

// v1 cost estimate: all metered usage is the main-conversation stream, so it
// is priced against the main profile. Auxiliary (compaction) tokens are not
// separately metered — per-provider subtotals are deferred to BACKLOG #14.
// See docs/DECISIONS.md 2026-06-02 (supersedes Parameter 18's subtotal clause).
function costFor(snapshot: StatusSnapshot): number | null {
  if (!snapshot.usage) return null;
  const main = snapshot.mainProviderId ? getProvider(snapshot.mainProviderId) : null;
  const mainPricing: ProviderPricing | undefined = main?.pricing[snapshot.mainModelId ?? ""];
  if (!mainPricing) return null;
  const { inputTokens, outputTokens, cachedInputTokens } = snapshot.usage;
  const cachedRate = mainPricing.cachedInputPerMTok ?? mainPricing.inputPerMTok * 0.1;
  return (
    (inputTokens * mainPricing.inputPerMTok +
      outputTokens * mainPricing.outputPerMTok +
      cachedInputTokens * cachedRate) /
    1_000_000
  );
}

function describeSession(snapshot: StatusSnapshot): string {
  const lines: string[] = [];
  const sid = snapshot.sessionId ? snapshot.sessionId.slice(0, 12) : "(ephemeral)";
  const age =
    snapshot.sessionStartedAt != null
      ? ` · ${formatAge(Date.now() - snapshot.sessionStartedAt)}`
      : "";
  lines.push(`Session: ${sid}${age}`);
  lines.push(`Main: ${snapshot.mainProviderId ?? "—"} / ${snapshot.mainModelId ?? "(default)"}`);
  lines.push(
    `Auxiliary: ${snapshot.auxiliaryProviderId ?? "(= main)"} / ${snapshot.auxiliaryModelId ?? "(default)"}`,
  );
  lines.push(`Messages: ${snapshot.messageCount}`);

  if (snapshot.usage) {
    const u = snapshot.usage;
    const total = u.inputTokens + u.outputTokens + u.cachedInputTokens;
    lines.push(
      `Tokens: ${formatTokens(u.inputTokens)} in / ${formatTokens(u.outputTokens)} out` +
        (u.cachedInputTokens > 0 ? ` / ${formatTokens(u.cachedInputTokens)} cached` : "") +
        ` / ${formatTokens(total)} total`,
    );
    const pctNum = Math.round(u.contextPercent * 100);
    lines.push(
      `Context: ${formatTokens(u.contextTokens)} / ${formatTokens(u.contextLimit)} (${pctNum}%)`,
    );
    lines.push(`Turns: ${u.turns}`);
  } else {
    lines.push("Tokens: — (no usage events yet)");
  }

  const cost = costFor(snapshot);
  // The estimate prices everything at main; flag the gap when a different
  // auxiliary provider has actually run a compaction this session.
  const auxDiffers =
    snapshot.auxiliaryProviderId != null &&
    snapshot.auxiliaryProviderId !== snapshot.mainProviderId;
  const auxNote =
    cost != null && auxDiffers && snapshot.lastCompaction != null
      ? " (excludes auxiliary compaction cost)"
      : "";
  lines.push(`Estimated cost: ${cost != null ? `$${cost.toFixed(4)}${auxNote}` : "—"}`);

  if (snapshot.lastCompaction) {
    const c = snapshot.lastCompaction;
    lines.push(
      `Last compaction: ${formatTokens(c.before)} → ${formatTokens(c.after)} tokens` +
        ` (saved ${formatTokens(c.tokensSaved)}, ${formatAge(Date.now() - c.at)} ago)`,
    );
  }

  if (snapshot.mcpServers.length > 0) {
    const summary = snapshot.mcpServers.map((s) => `${s.id} (${s.toolCount} tools)`).join(", ");
    lines.push(`MCP: ${summary}`);
  } else {
    lines.push("MCP: (no connected servers)");
  }

  return lines.join("\n");
}

const statusCommand: Command = {
  name: "status",
  description: "Show session stats: provider/model, tokens, context %, cost, MCP",
  async handler(_args, ctx): Promise<CommandResult> {
    const snapshot = ctx.getStatus();
    return { items: [{ text: describeSession(snapshot) }] };
  },
};

export default statusCommand;
