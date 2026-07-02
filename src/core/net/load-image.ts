import { proxiedFetch } from "./proxied-fetch";
import { validateProxiedEgressUrl } from "./validate-egress-url";

// Cap the rendered image size. Checked against Content-Length up front (cheap
// reject) and the actual body afterward (in case the header lied / was absent).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Fetch a remote image through the Rust proxy and return an object URL for it.
 *
 * This is UNTRUSTED-CONTENT egress (the URL comes from LLM/MCP markdown), so:
 *  - the strict SSRF guard rejects private/internal/loopback/metadata hosts,
 *  - `maxRedirections: 0` blocks redirect-to-internal after the host check,
 *  - the response must have an `image/*` Content-Type and be within the cap.
 *
 * The returned object URL must be revoked by the caller (URL.revokeObjectURL)
 * on unmount / when the source changes.
 */
export async function loadImageAsObjectUrl(rawUrl: string): Promise<string> {
  const err = validateProxiedEgressUrl(rawUrl); // strict: blocks private hosts
  if (err) throw new Error(err);

  const res = await proxiedFetch(rawUrl, { maxRedirections: 0 });
  if (!res.ok) {
    throw new Error(`Image request failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Not an image (${contentType || "unknown type"})`);
  }

  const declaredLength = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large");
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large");
  }

  return URL.createObjectURL(new Blob([buffer], { type: contentType }));
}
