import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadImageAsObjectUrl } from "@/core/net/load-image";
import {
  resetTrustedImageHostsForTests,
  seedTrustedImageHosts,
} from "@/core/net/trusted-image-hosts";
import { MarkdownImage } from "./markdown-image";

vi.mock("@/core/net/load-image", () => ({ loadImageAsObjectUrl: vi.fn() }));
// trusted-image-hosts persists via saveSettings on trust; stub the store layer.
vi.mock("@/core/settings/settings", () => ({ saveSettings: vi.fn(async () => ({})) }));

const mockedLoad = vi.mocked(loadImageAsObjectUrl);

describe("MarkdownImage", () => {
  beforeEach(() => {
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    resetTrustedImageHostsForTests();
    vi.clearAllMocks();
  });

  it("does NOT fetch a remote image by default (placeholder only)", () => {
    render(<MarkdownImage src="https://cdn.example.com/a.png" alt="chart" />);
    expect(mockedLoad).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("cdn.example.com")).toBeInTheDocument();
    expect(screen.getByText("Load image")).toBeInTheDocument();
  });

  it("loads through the proxy on click and renders a blob image", async () => {
    mockedLoad.mockResolvedValue("blob:xyz");
    render(<MarkdownImage src="https://cdn.example.com/a.png" alt="chart" />);
    fireEvent.click(screen.getByText("Load image"));
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:xyz"));
    expect(mockedLoad).toHaveBeenCalledWith("https://cdn.example.com/a.png");
  });

  it("shows an error when the guard/proxy rejects the image", async () => {
    mockedLoad.mockRejectedValue(new Error("URL points to a private or internal address"));
    render(<MarkdownImage src="http://169.254.169.254/x.png" alt="evil" />);
    fireEvent.click(screen.getByText("Load image"));
    await waitFor(() => expect(screen.getByText(/private or internal/)).toBeInTheDocument());
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("auto-loads from a trusted host without a click", async () => {
    seedTrustedImageHosts(["cdn.example.com"]);
    mockedLoad.mockResolvedValue("blob:auto");
    render(<MarkdownImage src="https://cdn.example.com/a.png" alt="auto" />);
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:auto"));
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });

  it("renders data: images directly without the proxy", () => {
    render(<MarkdownImage src="data:image/png;base64,AAAA" alt="inline" />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("on src change: revokes the old blob and shows the placeholder for the new src", async () => {
    mockedLoad.mockResolvedValue("blob:a");
    const { rerender } = render(<MarkdownImage src="https://a.example/x.png" alt="a" />);
    fireEvent.click(screen.getByText("Load image"));
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:a"));

    rerender(<MarkdownImage src="https://b.example/y.png" alt="b" />);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a");
    expect(screen.queryByRole("img")).toBeNull(); // no stale/revoked blob rendered
    expect(screen.getByText("b.example")).toBeInTheDocument();
    expect(screen.getByText("Load image")).toBeInTheDocument();
  });
});
