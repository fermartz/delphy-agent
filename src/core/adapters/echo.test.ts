import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../types";
import { echoAdapter } from "./echo";

async function collect(
  session: Awaited<ReturnType<typeof echoAdapter.start>>,
): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of session.events) {
    out.push(ev);
    if (ev.type === "done") break;
  }
  return out;
}

describe("echoAdapter", () => {
  it("emits text deltas, then usage, then done(complete)", async () => {
    const session = await echoAdapter.start({});
    await session.sendMessage("hello");

    const events = await collect(session);

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.length).toBeGreaterThanOrEqual(1);

    const usage = events.find((e) => e.type === "usage");
    expect(usage).toBeDefined();
    if (usage?.type === "usage") {
      expect(usage.inputTokens).toBe(5);
    }

    const last = events.at(-1);
    expect(last?.type).toBe("done");
    if (last?.type === "done") {
      expect(last.reason).toBe("complete");
    }

    await session.close();
  });

  it("reassembles the streamed text to 'Echo: <input>'", async () => {
    const session = await echoAdapter.start({});
    await session.sendMessage("world");

    const events = await collect(session);
    const reassembled = events
      .filter((e): e is Extract<AgentEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta)
      .join("");

    expect(reassembled).toBe("Echo: world");

    await session.close();
  });

  it("has the right adapter id and kind", () => {
    expect(echoAdapter.id).toBe("echo");
    expect(echoAdapter.kind).toBe("direct-api");
  });

  it("emits exactly one terminal done when interrupted mid-stream", async () => {
    const session = await echoAdapter.start({});
    await session.sendMessage("interrupt me please");

    const events: AgentEvent[] = [];
    const iterator = session.events[Symbol.asyncIterator]();

    // Pull one text event, then interrupt before the stream finishes.
    const first = await iterator.next();
    if (!first.done) events.push(first.value);
    await session.interrupt();

    while (true) {
      const step = await iterator.next();
      if (step.done) break;
      events.push(step.value);
      if (step.value.type === "done") break;
    }

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(1);
    if (doneEvents[0]?.type === "done") {
      expect(doneEvents[0].reason).toBe("interrupted");
    }

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(0);

    await session.close();
  });
});
