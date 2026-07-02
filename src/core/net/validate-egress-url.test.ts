import { describe, expect, it } from "vitest";
import { isPrivateOrLocalHost, validateProxiedEgressUrl } from "./validate-egress-url";

describe("isPrivateOrLocalHost", () => {
  const privateHosts = [
    "localhost",
    "foo.localhost",
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "192.168.1.5",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
  ];
  for (const h of privateHosts) {
    it(`flags ${h} as private/internal`, () => {
      expect(isPrivateOrLocalHost(h)).toBe(true);
    });
  }

  const publicHosts = ["example.com", "8.8.8.8", "1.1.1.1", "203.0.113.5", "api.openai.com"];
  for (const h of publicHosts) {
    it(`treats ${h} as public`, () => {
      expect(isPrivateOrLocalHost(h)).toBe(false);
    });
  }
});

describe("validateProxiedEgressUrl — strict (untrusted content / images)", () => {
  it("allows public http and https", () => {
    expect(validateProxiedEgressUrl("https://example.com/x.png")).toBeNull();
    expect(validateProxiedEgressUrl("http://example.com/x.png")).toBeNull();
  });

  const blocked = [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.1/x",
    "https://192.168.1.5/x",
    "http://169.254.169.254/latest/meta-data",
    "http://[::]/x", // unspecified
    "http://[::1]/x",
    "http://[::ffff:10.0.0.1]/x", // IPv4-mapped IPv6
    "http://[::ffff:7f00:1]/x", // IPv4-mapped loopback (hex hextets)
    "http://[fc00::1]/x",
    "http://[fe80::1]/x",
    // NAT64 well-known prefix 64:ff9b::/96 wrapping private/loopback/metadata IPv4
    "http://[64:ff9b::a00:1]/x", // 10.0.0.1
    "http://[64:ff9b::7f00:1]/x", // 127.0.0.1
    "http://[64:ff9b::a9fe:a9fe]/x", // 169.254.169.254 metadata
    "http://0.0.0.0/x",
    "http://foo.localhost/x",
    // IPv4 encoded as decimal / hex / octal — WHATWG normalizes to 127.0.0.1
    "http://2130706433/x",
    "http://0x7f000001/x",
    "http://0177.0.0.1/x",
    // short-form IPv4 — WHATWG expands (127.1 -> 127.0.0.1, 192.168.1 -> 192.168.0.1)
    "http://127.1/x",
    "http://192.168.1/x",
    "http://0/x", // -> 0.0.0.0
    // IPv4-mapped IPv6 of the cloud-metadata address
    "http://[::ffff:169.254.169.254]/x",
    // trailing-dot fqdn form of a loopback literal
    "http://127.0.0.1./x",
  ];
  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      expect(validateProxiedEgressUrl(url)).toMatch(/private or internal/);
    });
  }

  it("rejects embedded credentials", () => {
    expect(validateProxiedEgressUrl("https://user:pass@example.com/")).toMatch(/credentials/);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateProxiedEgressUrl("file:///etc/passwd")).toMatch(/http or https/);
    expect(validateProxiedEgressUrl("ftp://example.com/")).toMatch(/http or https/);
  });

  it("rejects empty and malformed URLs", () => {
    expect(validateProxiedEgressUrl(undefined)).toMatch(/required/);
    expect(validateProxiedEgressUrl("   ")).toMatch(/required/);
    expect(validateProxiedEgressUrl("not a url")).toMatch(/not valid/);
  });

  it("allows a public fqdn with a trailing dot", () => {
    expect(validateProxiedEgressUrl("https://example.com./x.png")).toBeNull();
  });

  it("does not over-block NAT64/mapped forms wrapping a PUBLIC IPv4", () => {
    // 64:ff9b::8.8.8.8 -> 64:ff9b::808:808 (public 8.8.8.8) must stay allowed.
    expect(validateProxiedEgressUrl("http://[64:ff9b::8.8.8.8]/x")).toBeNull();
    expect(validateProxiedEgressUrl("http://[::ffff:8.8.8.8]/x")).toBeNull();
  });
});

describe("validateProxiedEgressUrl — user-config (remote MCP policy)", () => {
  const opts = { requireHttpsExceptLoopback: true, allowPrivateHosts: true };

  it("allows https to any host, including private (D1: broad + warning)", () => {
    expect(validateProxiedEgressUrl("https://example.com/mcp", opts)).toBeNull();
    expect(validateProxiedEgressUrl("https://192.168.1.5/mcp", opts)).toBeNull();
  });

  it("allows http only for loopback hosts", () => {
    expect(validateProxiedEgressUrl("http://localhost:3000/mcp", opts)).toBeNull();
    expect(validateProxiedEgressUrl("http://127.0.0.1:8080", opts)).toBeNull();
  });

  it("rejects http to a non-loopback host", () => {
    expect(validateProxiedEgressUrl("http://example.com/mcp", opts)).toMatch(/https/);
  });

  it("still rejects embedded credentials", () => {
    expect(validateProxiedEgressUrl("https://user:pass@example.com/mcp", opts)).toMatch(
      /credentials/,
    );
  });
});
