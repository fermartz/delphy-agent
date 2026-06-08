import type { RefObject } from "react";
import { ChatIcon } from "@/components/chat-icon";
import { ChatMessage } from "@/components/chat-message";
import type { ActiveBackend } from "@/core/boot";
import type { ChatItem } from "@/core/chat-projection";

interface ChatStreamProps {
  items: ChatItem[];
  backend: ActiveBackend | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onApproval: (id: string, allowed: boolean) => void;
  onChangeKey: () => void;
}

/**
 * Scrollable chat history: empty-state copy or the list of ChatIcon + ChatMessage
 * rows. The scroll container's ref + onScroll are owned by the caller (auto-scroll
 * sticky-bottom logic), so identity is preserved across renders.
 */
export function ChatStream({
  items,
  backend,
  scrollRef,
  onScroll,
  onApproval,
  onChangeKey,
}: ChatStreamProps) {
  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {backend === "anthropic-api"
            ? "Type a message to chat with Claude."
            : "Type a message to see the echo adapter stream."}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="flex gap-2">
              <ChatIcon item={it} />
              <div className="flex-1">
                <ChatMessage item={it} onApproval={onApproval} onChangeKey={onChangeKey} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
