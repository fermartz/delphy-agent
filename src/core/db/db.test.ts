import { invoke } from "@tauri-apps/api/core";
import type { ModelMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type MockDb } from "./db-mock";
import { setDbForTests } from "./init";
import { countMcpConfigs, listMcpConfigsFromDb, replaceMcpConfigs, seedMcpConfigs } from "./mcp";
import { GLOBAL_MEMORY_ID, loadMemory, MEMORY_MAX_CHARS, saveMemory } from "./memory";
import {
  appendMessage,
  deserializeMessage,
  loadMessages,
  replaceMessages,
  serializeMessage,
} from "./messages";
import {
  createSession,
  getMostRecentSession,
  getSession,
  listSessions,
  pruneEmptySessions,
  touchSession,
  updateSessionTitle,
} from "./sessions";

// replaceMessages runs its atomic rewrite in Rust via invoke() (real
// transaction semantics are covered by the Rust test in src-tauri/src/db_tx.rs);
// the TS side only serializes rows + wires the command.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

describe("db", () => {
  let mock: MockDb;

  beforeEach(() => {
    mock = createTestDb();
    setDbForTests(mock);
    mockedInvoke.mockReset();
  });

  afterEach(() => {
    setDbForTests(null);
  });

  describe("sessions", () => {
    it("creates and retrieves a session", async () => {
      await createSession({
        id: "s1",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "claude-sonnet-4-6",
      });
      const row = await getSession("s1");
      expect(row).not.toBeNull();
      expect(row?.id).toBe("s1");
      expect(row?.backend_id).toBe("anthropic-api");
      expect(row?.main_model).toBe("claude-sonnet-4-6");
    });

    it("returns null for unknown session", async () => {
      expect(await getSession("nope")).toBeNull();
    });

    it("getMostRecentSession returns the most recently updated", async () => {
      await createSession({
        id: "s1",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m1",
      });
      await new Promise((r) => setTimeout(r, 5));
      await createSession({
        id: "s2",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m2",
      });
      const most = await getMostRecentSession();
      expect(most?.id).toBe("s2");
    });

    it("touchSession updates updated_at", async () => {
      await createSession({
        id: "s1",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m1",
      });
      const before = (await getSession("s1"))?.updated_at ?? 0;
      await new Promise((r) => setTimeout(r, 5));
      await touchSession("s1");
      const after = (await getSession("s1"))?.updated_at ?? 0;
      expect(after).toBeGreaterThan(before);
    });

    it("updateSessionTitle persists title", async () => {
      await createSession({
        id: "s1",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m1",
      });
      await updateSessionTitle("s1", "My chat");
      const row = await getSession("s1");
      expect(row?.title).toBe("My chat");
    });

    it("listSessions returns in descending updated_at order", async () => {
      await createSession({
        id: "a",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m",
      });
      await new Promise((r) => setTimeout(r, 5));
      await createSession({
        id: "b",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m",
      });
      const list = await listSessions();
      expect(list.map((s) => s.id)).toEqual(["b", "a"]);
    });

    it("pruneEmptySessions removes only sessions with no messages", async () => {
      await createSession({
        id: "withMsg",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m",
      });
      await createSession({
        id: "empty1",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m",
      });
      await createSession({
        id: "empty2",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m",
      });
      await appendMessage("withMsg", 0, { role: "user", content: "hi" });
      const removed = await pruneEmptySessions();
      expect(removed).toBe(2);
      const list = await listSessions();
      expect(list.map((s) => s.id)).toEqual(["withMsg"]);
    });

    it("pruneEmptySessions is a no-op when all sessions have messages", async () => {
      await createSession({
        id: "a",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m",
      });
      await appendMessage("a", 0, { role: "user", content: "hi" });
      const removed = await pruneEmptySessions();
      expect(removed).toBe(0);
    });
  });

  describe("messages: serialize/deserialize", () => {
    it("round-trips user text", () => {
      const msg: ModelMessage = { role: "user", content: "hello" };
      const r = serializeMessage(msg);
      expect(r.role).toBe("user");
      expect(deserializeMessage(r)).toEqual(msg);
    });

    it("round-trips assistant text block", () => {
      const msg: ModelMessage = {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      };
      const r = serializeMessage(msg);
      expect(deserializeMessage(r)).toEqual(msg);
    });

    it("round-trips assistant tool-call block", () => {
      const msg: ModelMessage = {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool-call", toolCallId: "t1", toolName: "fetch", input: { url: "x" } },
        ],
      };
      const r = serializeMessage(msg);
      expect(deserializeMessage(r)).toEqual(msg);
    });

    it("round-trips tool-result", () => {
      const msg: ModelMessage = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "t1",
            toolName: "fetch",
            output: { type: "text", value: "ok" },
          },
        ],
      };
      const r = serializeMessage(msg);
      expect(deserializeMessage(r)).toEqual(msg);
    });

    it("round-trips thinking block", () => {
      const msg: ModelMessage = {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "answer" },
        ],
      };
      const r = serializeMessage(msg);
      expect(deserializeMessage(r)).toEqual(msg);
    });
  });

  describe("messages: persistence", () => {
    beforeEach(async () => {
      await createSession({
        id: "s1",
        backend_id: "anthropic-api",
        main_provider: "anthropic",
        main_model: "m1",
      });
    });

    it("appendMessage + loadMessages preserves order", async () => {
      await appendMessage("s1", 0, { role: "user", content: "first" });
      await appendMessage("s1", 1, { role: "assistant", content: [{ type: "text", text: "1" }] });
      await appendMessage("s1", 2, { role: "user", content: "second" });
      const loaded = await loadMessages("s1");
      expect(loaded).toHaveLength(3);
      expect(loaded[0].content).toBe("first");
      expect(loaded[2].content).toBe("second");
    });

    it("loadMessages returns [] for empty session", async () => {
      expect(await loadMessages("s1")).toEqual([]);
    });

    it("replaceMessages invokes the atomic Rust command with serialized, seq-ordered rows", async () => {
      const compacted: ModelMessage[] = [
        { role: "assistant", content: [{ type: "text", text: "[delphy:summary] summary" }] },
        { role: "user", content: "new" },
      ];

      await replaceMessages("s1", compacted);

      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      const [command, args] = mockedInvoke.mock.calls[0];
      expect(command).toBe("replace_session_messages");
      const typed = args as { sessionId: string; messages: Array<Record<string, unknown>> };
      expect(typed.sessionId).toBe("s1");
      expect(typed.messages).toHaveLength(2);
      expect(typed.messages[0]).toMatchObject({
        seq: 0,
        role: "assistant",
        content: JSON.stringify([{ type: "text", text: "[delphy:summary] summary" }]),
      });
      expect(typed.messages[1]).toMatchObject({
        seq: 1,
        role: "user",
        content: JSON.stringify("new"),
      });
      // Each row carries a generated id + created_at for the pure Rust writer.
      for (const row of typed.messages) {
        expect(typeof row.id).toBe("string");
        expect(typeof row.created_at).toBe("number");
      }
    });

    it("replaceMessages surfaces a Rust command failure to the caller", async () => {
      mockedInvoke.mockRejectedValueOnce(new Error("database sqlite:delphy.db is not loaded"));
      await expect(replaceMessages("s1", [{ role: "user", content: "x" }])).rejects.toThrow(
        /not loaded/,
      );
    });
  });

  describe("memory", () => {
    it("loadMemory returns empty string when nothing saved", async () => {
      expect(await loadMemory()).toBe("");
    });

    it("saveMemory + loadMemory round-trips", async () => {
      await saveMemory("hello world");
      expect(await loadMemory()).toBe("hello world");
    });

    it("saveMemory overwrites existing content", async () => {
      await saveMemory("first");
      await saveMemory("second");
      expect(await loadMemory()).toBe("second");
    });

    it("saveMemory truncates content past MEMORY_MAX_CHARS", async () => {
      const long = "x".repeat(MEMORY_MAX_CHARS + 500);
      const result = await saveMemory(long);
      expect(result.truncated).toBe(true);
      expect(result.saved.length).toBe(MEMORY_MAX_CHARS);
      expect((await loadMemory()).length).toBe(MEMORY_MAX_CHARS);
    });

    it("uses global id by default", async () => {
      await saveMemory("g");
      expect(await loadMemory(GLOBAL_MEMORY_ID)).toBe("g");
    });
  });

  describe("mcp", () => {
    it("countMcpConfigs returns 0 for empty table", async () => {
      expect(await countMcpConfigs()).toBe(0);
    });

    it("replaceMcpConfigs writes configs round-trippable via list", async () => {
      const configs = [
        {
          id: "fetch",
          name: "Fetch",
          enabled: true,
          transport: "stdio" as const,
          command: "npx",
          args: ["-y", "mcp-fetch-server"],
        },
      ];
      await replaceMcpConfigs(configs);
      const loaded = await listMcpConfigsFromDb();
      expect(loaded).toEqual(configs);
    });

    it("seedMcpConfigs only writes when table is empty", async () => {
      await seedMcpConfigs([
        { id: "a", name: "A", enabled: true, transport: "stdio", command: "x" },
      ]);
      await seedMcpConfigs([
        { id: "b", name: "B", enabled: true, transport: "stdio", command: "y" },
      ]);
      const list = await listMcpConfigsFromDb();
      expect(list.map((c) => c.id)).toEqual(["a"]);
    });

    it("replaceMcpConfigs clears and replaces entirely", async () => {
      await replaceMcpConfigs([
        { id: "a", name: "A", enabled: true, transport: "stdio", command: "x" },
      ]);
      await replaceMcpConfigs([
        { id: "b", name: "B", enabled: false, transport: "stdio", command: "y" },
      ]);
      const list = await listMcpConfigsFromDb();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe("b");
      expect(list[0].enabled).toBe(false);
    });
  });
});
