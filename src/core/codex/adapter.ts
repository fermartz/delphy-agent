import type { BackendAdapter, Session, SessionOptions } from "../types";
import { CODEX_SERVER_ID } from "./config";
import { connectCodex } from "./connect";
import { CodexSession } from "./session";

/**
 * Codex backend adapter — drives `codex mcp-server` via the existing Rust MCP
 * bridge. `kind: "agent-cli"`. Requires `opts.cwd` (the working directory the
 * Codex session operates in; Slice A is read-only). Sessions are ephemeral:
 * `boot.ts` constructs them without a sessionId/persister, so there's no SQLite
 * persistence or resume.
 */
export const codexAdapter: BackendAdapter = {
  id: CODEX_SERVER_ID,
  kind: "agent-cli",
  label: "Codex",
  async start(opts: SessionOptions): Promise<Session> {
    const cwd = opts.cwd;
    if (!cwd || cwd.trim().length === 0) {
      throw new Error("Codex requires a working directory.");
    }
    const { client, transport } = await connectCodex();
    return new CodexSession({ client, transport, cwd });
  },
};
