/**
 * Shared proxied fetch for ALL provider + user-controlled network egress.
 *
 * `@tauri-apps/plugin-http`'s `fetch` routes every request through the Rust
 * side instead of the webview network stack. That means: no key-bearing
 * request leaves the webview directly (VISION #1), egress stays behind the
 * capability-scoped Tauri boundary, and — with a strict CSP — `connect-src`
 * need not enumerate any external provider host (so adding a provider needs
 * no CSP change). Mirrors the MCP remote transport factory, which feeds the
 * same fetch to the SDK transports.
 */
export { fetch as proxiedFetch } from "@tauri-apps/plugin-http";
