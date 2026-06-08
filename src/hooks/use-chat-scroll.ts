import { useCallback, useEffect, useRef } from "react";
import type { ChatItem } from "@/core/chat-projection";

/**
 * Sticky-bottom auto-scroll for the chat history. Auto-scrolls to the bottom on
 * each items change, but only while the user is already pinned near the bottom
 * (within 32px) — scrolling up to read disables it until they return. Extracted
 * verbatim from App.tsx. Returns the scroll container ref + onScroll handler to
 * attach to the scrollable element.
 */
export function useChatScroll(items: ChatItem[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items is an effect-trigger — its array identity changes on every text delta via reduceChatItems, which is exactly when auto-scroll should re-run.
  useEffect(() => {
    if (!stickyBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyBottomRef.current = distFromBottom < 32;
  }, []);

  return { scrollRef, onScroll };
}
