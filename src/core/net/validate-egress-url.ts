/**
 * Shared SSRF / egress-URL validation for anything sent through the proxied
 * fetch (`src/core/net/proxied-fetch.ts`). Two policies, via `opts`:
 *
 *  - **User-configured URLs** (remote MCP server, custom base URL): permissive
 *    host policy (D1 = broad + a UI warning) — the user chose the URL, and
 *    local/LAN MCP servers are a legitimate case — but https-only-except-
 *    loopback and no embedded credentials.
 *  - **Untrusted content** (markdown image URLs from LLM/MCP output): strict —
 *    reject any private / internal / loopback / link-local / metadata host so
 *    a reply can't smuggle `![](http://169.254.169.254/…)` past the proxy.
 *
 * This is a HOST-LITERAL guard: it does not resolve DNS, so a public hostname
 * that resolves to a private IP (DNS rebinding) or an HTTP redirect to an
 * internal host is NOT caught here — that is the tracked follow-up. Image loads
 * additionally pass `maxRedirections: 0` to close the redirect vector.
 *
 * IPv4 literals in decimal/octal/hex form (e.g. 2130706433, 0x7f000001) are
 * normalized to dotted-decimal by the WHATWG URL parser before we see them, so
 * we only range-check the canonical host.
 */

export interface EgressUrlOptions {
  /** Permit private/internal/loopback hosts (the user chose the URL). Default false. */
  allowPrivateHosts?: boolean;
  /** Require https, allowing plain http only for loopback hosts. Default false. */
  requireHttpsExceptLoopback?: boolean;
}

// Plain http is permitted only to these hosts (local dev servers). [::1] is
// intentionally excluded: the Tauri HTTP capability scope can't express a
// bracketed-IPv6 url pattern, so it would validate but be blocked at egress.
const HTTP_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1); // fqdn trailing dot
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1); // ipv6 brackets
  return h;
}

function ipv4Octets(host: string): number[] | null {
  const m = IPV4_RE.exec(host);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  return octets.some((o) => o > 255) ? null : octets;
}

function isPrivateIPv4(o: number[]): boolean {
  const [a, b] = o;
  return (
    a === 0 || // 0.0.0.0/8 ("this host")
    a === 10 || // 10/8
    a === 127 || // 127/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    (a === 169 && b === 254) || // 169.254/16 link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) // 192.168/16
  );
}

function hextetsToIPv4(hi: number, lo: number): number[] {
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
}

/** Expand a de-bracketed IPv6 literal to its 8 hextets, or null if unparseable. */
function expandIPv6(host: string): number[] | null {
  let h = host;
  // A trailing dotted IPv4 (e.g. ::ffff:1.2.3.4) — fold into two hex hextets.
  const dotted = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) {
    const o = ipv4Octets(dotted[1]);
    if (!o) return null;
    const hi = ((o[0] << 8) | o[1]).toString(16);
    const lo = ((o[2] << 8) | o[3]).toString(16);
    h = `${h.slice(0, dotted.index + 1)}${hi}:${lo}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  if (halves.length === 1 && missing !== 0) return null; // no "::" but not 8 groups
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => Number.parseInt(g, 16));
  return nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : nums;
}

function isPrivateIPv6(host: string): boolean {
  const g = expandIPv6(host);
  if (!g) return false;
  if (g.every((x) => x === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
  if (g[0] >= 0xfc00 && g[0] <= 0xfdff) return true; // fc00::/7 unique-local
  if (g[0] >= 0xfe80 && g[0] <= 0xfebf) return true; // fe80::/10 link-local
  const embedsIPv4 =
    (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) || // ::ffff:0:0/96 mapped
    (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0); // 64:ff9b::/96 NAT64
  if (embedsIPv4) return isPrivateIPv4(hextetsToIPv4(g[6], g[7]));
  return false;
}

/**
 * True if the host is a loopback / private / internal / link-local / metadata
 * literal (or `localhost`). Public DNS names return false (rebinding is the
 * tracked follow-up, not caught here).
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const v4 = ipv4Octets(h);
  if (v4) return isPrivateIPv4(v4);
  if (h.includes(":")) return isPrivateIPv6(h);
  return false;
}

/** Returns an error message, or null if the URL is acceptable for proxied egress. */
export function validateProxiedEgressUrl(
  rawUrl: string | undefined,
  opts: EgressUrlOptions = {},
): string | null {
  const url = rawUrl?.trim();
  if (!url) return "URL is required";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "URL is not valid";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "URL must use http or https";
  }
  if (parsed.username || parsed.password) {
    return "URL must not contain embedded credentials";
  }

  if (opts.requireHttpsExceptLoopback && parsed.protocol !== "https:") {
    const isLoopbackHttp = HTTP_LOOPBACK_HOSTS.has(normalizeHost(parsed.hostname));
    if (!isLoopbackHttp) {
      return "URL must use https (http is allowed only for localhost)";
    }
  }

  if (!opts.allowPrivateHosts && isPrivateOrLocalHost(parsed.hostname)) {
    return "URL points to a private or internal address";
  }

  return null;
}
