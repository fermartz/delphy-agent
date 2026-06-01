import type { ModelMessage } from "ai";
import { appendMessage, loadMessages, replaceMessages } from "./db/messages";
import {
  createSession,
  getMostRecentSession,
  pruneEmptySessions,
  touchSession,
} from "./db/sessions";
import type { MessagePersister } from "./types";

function nextSessionId(): string {
  return `s-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export interface ResolvedSessionContext {
  sessionId: string;
  initialMessages: ModelMessage[];
  persister: MessagePersister;
  resumed: boolean;
}

interface CreationMeta {
  backendId: string;
  mainModel: string;
}

/**
 * Locate the most recent session for the given backend + model and reuse it,
 * or stage a fresh id (lazily created). A model mismatch stages a new id;
 * the old session remains in the DB for sidebar resume. Empty sessions are
 * never INSERTed — `makePersister` lazily creates the row on the first
 * actual persist call, so React-Strict-Mode double-mounts + model changes
 * + idle "New session" clicks don't pollute the sidebar.
 */
export async function resolveSessionContext(input: {
  backendId: string;
  mainModel: string;
}): Promise<ResolvedSessionContext> {
  try {
    await pruneEmptySessions();
  } catch (err) {
    console.warn("[session-manager] pruneEmptySessions failed", err);
  }

  try {
    const recent = await getMostRecentSession();
    if (recent && recent.backend_id === input.backendId && recent.main_model === input.mainModel) {
      const initialMessages = await loadMessages(recent.id);
      return {
        sessionId: recent.id,
        initialMessages,
        persister: makePersister(recent.id),
        resumed: true,
      };
    }
  } catch (err) {
    console.warn("[session-manager] resolve failed, starting ephemeral session", err);
  }

  const sessionId = nextSessionId();
  return {
    sessionId,
    initialMessages: [],
    persister: makePersister(sessionId, {
      backendId: input.backendId,
      mainModel: input.mainModel,
    }),
    resumed: false,
  };
}

export async function createFreshSession(input: {
  backendId: string;
  mainModel: string;
}): Promise<ResolvedSessionContext> {
  const sessionId = nextSessionId();
  return {
    sessionId,
    initialMessages: [],
    persister: makePersister(sessionId, {
      backendId: input.backendId,
      mainModel: input.mainModel,
    }),
    resumed: false,
  };
}

export async function loadSessionContext(sessionId: string): Promise<{
  initialMessages: ModelMessage[];
  persister: MessagePersister;
}> {
  const initialMessages = await loadMessages(sessionId);
  return { initialMessages, persister: makePersister(sessionId) };
}

function makePersister(sessionId: string, creationMeta?: CreationMeta): MessagePersister {
  let created = creationMeta === undefined;
  let creating: Promise<void> | null = null;

  async function ensureCreated(): Promise<void> {
    if (created) return;
    if (creating) {
      await creating;
      return;
    }
    if (!creationMeta) {
      created = true;
      return;
    }
    creating = (async () => {
      try {
        await createSession({
          id: sessionId,
          backend_id: creationMeta.backendId,
          main_model: creationMeta.mainModel,
        });
        created = true;
      } finally {
        creating = null;
      }
    })();
    await creating;
  }

  return {
    async append(seq, message) {
      await ensureCreated();
      await appendMessage(sessionId, seq, message as ModelMessage);
    },
    async replace(messages) {
      await ensureCreated();
      await replaceMessages(sessionId, messages as ModelMessage[]);
    },
    async touch() {
      if (!created) return;
      await touchSession(sessionId);
    },
  };
}
