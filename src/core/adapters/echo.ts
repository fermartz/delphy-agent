import type { AgentEvent, BackendAdapter, SendOptions, Session, SessionOptions } from "../types";

const CHUNK_DELAY_MS = 120;
const CHUNK_COUNT = 5;

function chunk(text: string, n: number): string[] {
  if (text.length === 0) return [""];
  const size = Math.max(1, Math.ceil(text.length / n));
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

interface Pending {
  text: string;
  signal?: AbortSignal;
}

class EchoSession implements Session {
  readonly id: string;
  private readonly queue: Pending[] = [];
  private resolveNext: (() => void) | null = null;
  private closed = false;
  private interrupted = false;

  constructor(id: string) {
    this.id = id;
  }

  async sendMessage(text: string, opts: SendOptions = {}): Promise<void> {
    if (this.closed) throw new Error("session closed");
    this.queue.push({ text, signal: opts.signal });
    this.resolveNext?.();
    this.resolveNext = null;
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
    this.resolveNext?.();
    this.resolveNext = null;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.resolveNext?.();
    this.resolveNext = null;
  }

  async respondToApproval(_id: string, _allowed: boolean): Promise<void> {
    // Echo never emits approval_request events; nothing to do.
  }

  events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]: () => this.iterate(),
  };

  private async *iterate(): AsyncIterator<AgentEvent> {
    while (!this.closed) {
      const next = this.queue.shift();
      if (!next) {
        await new Promise<void>((resolve) => {
          this.resolveNext = resolve;
        });
        continue;
      }

      const response = `Echo: ${next.text}`;
      const chunks = chunk(response, CHUNK_COUNT);

      let terminated: "interrupted" | "complete" | "error" | null = null;

      try {
        for (const piece of chunks) {
          if (this.interrupted) {
            this.interrupted = false;
            terminated = "interrupted";
            yield { type: "done", reason: "interrupted" };
            break;
          }
          await delay(CHUNK_DELAY_MS, next.signal);
          yield { type: "text", delta: piece };
        }

        if (terminated === null) {
          terminated = "complete";
          yield {
            type: "usage",
            inputTokens: next.text.length,
            outputTokens: response.length,
          };
          yield { type: "done", reason: "complete" };
        }
      } catch (err) {
        terminated = "error";
        yield { type: "error", error: err instanceof Error ? err : new Error(String(err)) };
        yield { type: "done", reason: "error" };
      }
    }
  }
}

let sessionCounter = 0;

export const echoAdapter: BackendAdapter = {
  id: "echo",
  kind: "direct-api",
  label: "Echo (stub)",

  async start(_opts: SessionOptions): Promise<Session> {
    sessionCounter += 1;
    return new EchoSession(`echo-${sessionCounter}`);
  },
};
