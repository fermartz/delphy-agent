import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadImageAsObjectUrl } from "./load-image";
import { proxiedFetch } from "./proxied-fetch";

vi.mock("./proxied-fetch", () => ({ proxiedFetch: vi.fn() }));

const mockedFetch = vi.mocked(proxiedFetch);

function imageResponse(
  bytes: number,
  type = "image/png",
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Map<string, string>([
    ["content-type", type],
    ...Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v] as [string, string]),
  ]);
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as unknown as Response;
}

describe("loadImageAsObjectUrl", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:mock-url"); // jsdom lacks object URLs
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a private/internal host BEFORE fetching (SSRF guard)", async () => {
    await expect(loadImageAsObjectUrl("http://169.254.169.254/x.png")).rejects.toThrow(
      /private or internal/,
    );
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("fetches with maxRedirections: 0 and returns an object URL for a public image", async () => {
    mockedFetch.mockResolvedValue(imageResponse(1234));
    const url = await loadImageAsObjectUrl("https://cdn.example.com/a.png");
    expect(url).toBe("blob:mock-url");
    expect(mockedFetch).toHaveBeenCalledWith("https://cdn.example.com/a.png", {
      maxRedirections: 0,
    });
  });

  it("rejects a non-image content-type", async () => {
    mockedFetch.mockResolvedValue(imageResponse(10, "text/html"));
    await expect(loadImageAsObjectUrl("https://example.com/x")).rejects.toThrow(/Not an image/);
  });

  it("rejects an over-large image by content-length", async () => {
    mockedFetch.mockResolvedValue(
      imageResponse(1, "image/png", { "content-length": String(20 * 1024 * 1024) }),
    );
    await expect(loadImageAsObjectUrl("https://example.com/big.png")).rejects.toThrow(/too large/);
  });

  it("rejects an over-large image by ACTUAL body size (absent/lying content-length)", async () => {
    mockedFetch.mockResolvedValue(imageResponse(11 * 1024 * 1024)); // 11 MB body, no header
    await expect(loadImageAsObjectUrl("https://example.com/big.png")).rejects.toThrow(/too large/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects a non-ok response (e.g. a blocked redirect)", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: { get: () => null },
    } as unknown as Response);
    await expect(loadImageAsObjectUrl("https://example.com/r.png")).rejects.toThrow(/302/);
  });
});
