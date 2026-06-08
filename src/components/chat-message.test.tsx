import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatItem } from "@/core/chat-projection";
import { ChatMessage } from "./chat-message";

const noop = () => {};

describe("ChatMessage", () => {
  describe("approval card", () => {
    const pending: ChatItem = {
      kind: "approval",
      id: "appr-1",
      action: "delphy__search",
      payload: { q: "x" },
    };

    it("shows the pending prompt and fires onApproval(id, true) on Approve", async () => {
      const user = userEvent.setup();
      const onApproval = vi.fn();
      render(<ChatMessage item={pending} onApproval={onApproval} onChangeKey={noop} />);
      expect(screen.getByText(/Agent wants to use delphy__search/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Approve" }));
      expect(onApproval).toHaveBeenCalledWith("appr-1", true);
    });

    it("fires onApproval(id, false) on Deny", async () => {
      const user = userEvent.setup();
      const onApproval = vi.fn();
      render(<ChatMessage item={pending} onApproval={onApproval} onChangeKey={noop} />);
      await user.click(screen.getByRole("button", { name: "Deny" }));
      expect(onApproval).toHaveBeenCalledWith("appr-1", false);
    });

    it("renders the verdict and no buttons once decided", () => {
      const decided: ChatItem = { ...pending, verdict: "allowed" };
      render(<ChatMessage item={decided} onApproval={vi.fn()} onChangeKey={noop} />);
      expect(screen.getByText(/Approval allowed — delphy__search/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
    });
  });

  describe("runtime-error", () => {
    it("shows a Change API key button for invalid-key and fires onChangeKey", async () => {
      const user = userEvent.setup();
      const onChangeKey = vi.fn();
      const item: ChatItem = {
        kind: "runtime-error",
        id: "e1",
        errorKind: "invalid-key",
        message: "401 Unauthorized",
      };
      render(<ChatMessage item={item} onApproval={vi.fn()} onChangeKey={onChangeKey} />);
      expect(screen.getByText("API key rejected")).toBeInTheDocument();
      expect(screen.getByText("401 Unauthorized")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Change API key" }));
      expect(onChangeKey).toHaveBeenCalledOnce();
    });

    it("omits the button for non-invalid-key errors", () => {
      const item: ChatItem = {
        kind: "runtime-error",
        id: "e2",
        errorKind: "network",
        message: "offline",
      };
      render(<ChatMessage item={item} onApproval={vi.fn()} onChangeKey={vi.fn()} />);
      expect(screen.getByText("Network error")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Change API key" })).not.toBeInTheDocument();
    });
  });

  describe("other kinds render", () => {
    it("user-text", () => {
      render(
        <ChatMessage
          item={{ kind: "user-text", id: "u", text: "hi there" }}
          onApproval={vi.fn()}
          onChangeKey={noop}
        />,
      );
      expect(screen.getByText("hi there")).toBeInTheDocument();
    });

    it("tool-call", () => {
      render(
        <ChatMessage
          item={{ kind: "tool-call", id: "tc", name: "search", input: { q: 1 } }}
          onApproval={vi.fn()}
          onChangeKey={noop}
        />,
      );
      expect(screen.getByText(/search/)).toBeInTheDocument();
    });

    it("tool-result success vs error", () => {
      const { rerender } = render(
        <ChatMessage
          item={{ kind: "tool-result", id: "tr", name: "search", output: "ok", isError: false }}
          onApproval={vi.fn()}
          onChangeKey={noop}
        />,
      );
      expect(screen.getByText("search completed")).toBeInTheDocument();
      rerender(
        <ChatMessage
          item={{ kind: "tool-result", id: "tr", name: "search", output: "boom", isError: true }}
          onApproval={vi.fn()}
          onChangeKey={noop}
        />,
      );
      expect(screen.getByText(/search failed:/)).toBeInTheDocument();
    });

    it("system", () => {
      render(
        <ChatMessage
          item={{ kind: "system", id: "s", text: "compacted" }}
          onApproval={vi.fn()}
          onChangeKey={noop}
        />,
      );
      expect(screen.getByText("compacted")).toBeInTheDocument();
    });
  });
});
