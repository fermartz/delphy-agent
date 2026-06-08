import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";

const baseProps = {
  input: "",
  onInputChange: vi.fn(),
  onSubmit: vi.fn((e) => e.preventDefault()),
  disabled: false,
  streaming: false,
  backendLabel: "Anthropic (Claude)",
};

describe("Composer", () => {
  it("renders the backend label in the placeholder", () => {
    render(<Composer {...baseProps} />);
    expect(screen.getByPlaceholderText("Message Anthropic (Claude)...")).toBeInTheDocument();
  });

  it("fires onInputChange as the user types", async () => {
    const user = userEvent.setup();
    const onInputChange = vi.fn();
    render(<Composer {...baseProps} onInputChange={onInputChange} />);
    await user.type(screen.getByRole("textbox"), "x");
    expect(onInputChange).toHaveBeenCalledWith("x");
  });

  it("fires onSubmit when the form is submitted", () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(<Composer {...baseProps} input="hi" onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByRole("textbox").closest("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("disables send when the input is empty/whitespace", () => {
    render(<Composer {...baseProps} input="   " />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("disables both the input and send when disabled=true", () => {
    render(<Composer {...baseProps} input="hi" disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("enables send when there is trimmed input and not disabled", () => {
    render(<Composer {...baseProps} input="hi" />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });
});
