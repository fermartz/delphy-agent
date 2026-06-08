import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatItem } from "@/core/chat-projection";
import { ChatStream } from "./chat-stream";

const baseProps = {
  scrollRef: createRef<HTMLDivElement>(),
  onScroll: vi.fn(),
  onApproval: vi.fn(),
  onChangeKey: vi.fn(),
};

describe("ChatStream", () => {
  it("shows the Claude empty-state for the anthropic backend", () => {
    render(<ChatStream {...baseProps} items={[]} backend="anthropic-api" />);
    expect(screen.getByText(/chat with Claude/i)).toBeInTheDocument();
  });

  it("shows the echo empty-state otherwise", () => {
    render(<ChatStream {...baseProps} items={[]} backend="echo-fallback" />);
    expect(screen.getByText(/echo adapter/i)).toBeInTheDocument();
  });

  it("renders items through ChatMessage", () => {
    const items: ChatItem[] = [
      { kind: "user-text", id: "u1", text: "hello world" },
      { kind: "assistant-text", id: "a1", text: "hi back", status: "complete" },
    ];
    render(<ChatStream {...baseProps} items={items} backend="anthropic-api" />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.getByText("hi back")).toBeInTheDocument();
  });

  it("wires the scroll container ref and fires onScroll", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const onScroll = vi.fn();
    render(
      <ChatStream
        {...baseProps}
        scrollRef={scrollRef}
        onScroll={onScroll}
        items={[]}
        backend="anthropic-api"
      />,
    );
    // identity: the ref points at the scroll container
    expect(scrollRef.current).not.toBeNull();
    expect(scrollRef.current?.className).toContain("overflow-y-auto");
    fireEvent.scroll(scrollRef.current as HTMLDivElement);
    expect(onScroll).toHaveBeenCalled();
  });
});
