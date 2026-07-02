import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadImageAsObjectUrl } from "@/core/net/load-image";
import {
  getTrustedImageHostsSnapshot,
  subscribeTrustedImageHosts,
  trustImageHost,
} from "@/core/net/trusted-image-hosts";

function hostOf(src: string): string | null {
  try {
    return new URL(src).hostname.toLowerCase();
  } catch {
    return null;
  }
}

interface MarkdownImageProps {
  src?: string;
  alt?: string;
}

/**
 * Renderer for markdown images. Remote images from LLM/MCP output are NOT
 * fetched by default (no `src` on a real <img>, no background-image, no
 * preload) — that neutralizes tracking pixels. The user can Load a single image
 * or "Always trust" its host; loading goes through the proxied fetch + strict
 * SSRF guard and renders a local `blob:` URL (CSP stays strict). `data:` images
 * are already local and render directly.
 *
 * The loaded blob is bound to the exact `src` it was fetched for and only
 * rendered while they match, so a `src` change (e.g. mid-stream markdown edits)
 * never shows a stale/revoked blob or suppresses a fresh trusted auto-load. A
 * monotonic `loadSeq` discards async loads that a `src` change has superseded.
 */
export function MarkdownImage({ src, alt }: MarkdownImageProps) {
  const trustedHosts = useSyncExternalStore(
    subscribeTrustedImageHosts,
    getTrustedImageHostsSnapshot,
  );
  const [loaded, setLoaded] = useState<{ src: string; url: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef<{ src: string; url: string } | null>(null);
  const loadSeq = useRef(0);

  const host = src ? hostOf(src) : null;
  const isTrusted = host ? trustedHosts.includes(host) : false;
  // Only render a blob that belongs to the CURRENT src.
  const currentUrl = loaded && loaded.src === src ? loaded.url : null;

  const load = useCallback(async () => {
    if (!src) return;
    const seq = ++loadSeq.current;
    setStatus("loading");
    setError(null);
    try {
      const url = await loadImageAsObjectUrl(src);
      if (seq !== loadSeq.current) {
        URL.revokeObjectURL(url); // superseded by a newer src/load — discard
        return;
      }
      if (loadedRef.current) URL.revokeObjectURL(loadedRef.current.url);
      loadedRef.current = { src, url };
      setLoaded({ src, url });
      setStatus("idle");
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : "Failed to load image");
    }
  }, [src]);

  // Reset transient state on src change; revoke the old blob + invalidate any
  // in-flight load on src change / unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed to src so reset+revoke run on every src change
  useEffect(() => {
    setLoaded(null);
    setStatus("idle");
    setError(null);
    return () => {
      loadSeq.current++;
      if (loadedRef.current) {
        URL.revokeObjectURL(loadedRef.current.url);
        loadedRef.current = null;
      }
    };
  }, [src]);

  // Auto-load once the host is trusted (re-runs if trust changes).
  useEffect(() => {
    if (src && !currentUrl && status === "idle" && isTrusted) void load();
  }, [src, currentUrl, status, isTrusted, load]);

  if (!src) return null;

  // Local data: images are already safe (no network) and CSP-allowed.
  if (src.startsWith("data:")) {
    return (
      <img src={src} alt={alt ?? ""} className="my-1 max-w-full rounded-md border border-border" />
    );
  }
  if (currentUrl) {
    return (
      <img
        src={currentUrl}
        alt={alt ?? ""}
        className="my-1 max-w-full rounded-md border border-border"
      />
    );
  }

  return (
    <span className="my-1 inline-flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span>
        Image from <span className="font-mono text-foreground">{host ?? "unknown host"}</span>
        {alt ? <span className="italic"> — {alt}</span> : null}
      </span>
      {status === "error" ? <span className="text-destructive">{error}</span> : null}
      <span className="flex gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={status === "loading"}
          className="text-primary underline disabled:opacity-50"
        >
          {status === "loading" ? "Loading…" : "Load image"}
        </button>
        {host ? (
          <button
            type="button"
            onClick={() => void trustImageHost(host)}
            disabled={status === "loading"}
            className="text-primary underline disabled:opacity-50"
          >
            Always trust this site
          </button>
        ) : null}
      </span>
    </span>
  );
}
