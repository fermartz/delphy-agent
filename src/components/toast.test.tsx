import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toast } from "./toast";

describe("Toast", () => {
  it("renders nothing when message is null", () => {
    const { container } = render(<Toast message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the message with fixed top-center positioning", () => {
    render(<Toast message="Theme updated — cyberpunk." />);
    const el = screen.getByText("Theme updated — cyberpunk.");
    expect(el).toBeInTheDocument();
    expect(el.className).toContain("fixed");
    expect(el.className).toContain("top-6");
  });
});
