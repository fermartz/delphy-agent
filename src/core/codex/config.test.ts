import { describe, expect, it } from "vitest";
import { buildCodexServerConfig, CODEX_SERVER_ID } from "./config";

describe("buildCodexServerConfig", () => {
  it("spawns `codex mcp-server` as a stdio MCP child", () => {
    const cfg = buildCodexServerConfig();
    expect(cfg).toEqual({
      id: CODEX_SERVER_ID,
      name: "Codex",
      enabled: true,
      transport: "stdio",
      command: "codex",
      args: ["mcp-server"],
    });
  });

  it("carries no cwd/sandbox/approval (those are codex-tool args, not spawn args)", () => {
    const cfg = buildCodexServerConfig();
    expect(cfg.env).toBeUndefined();
    expect(cfg.args).not.toContain("--cwd");
  });
});
