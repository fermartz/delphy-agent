# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use **GitHub's private vulnerability reporting**:

1. Go to the repository's **Security** tab on GitHub.
2. Click **Report a vulnerability**.
3. Fill out the form — describe the issue, the impact, and reproduction steps.

You will get a private channel to discuss the report directly with the maintainer. Reports are acknowledged within a reasonable window; fixes ship as soon as practical given the project's early-development stage.

If GitHub private vulnerability reporting is not available for any reason, open a placeholder issue titled "Security contact request" with no details and the maintainer will reach out to establish a private channel.

## In scope

- The desktop application itself (Tauri shell + React frontend)
- The secret store (`src-tauri/src/secrets.rs`, `keyring` crate integration, `${secret:…}` placeholder handling)
- Adapter implementations under `src/core/adapters/` (data flowing in and out of the LLM provider)
- The MCP stdio bridge once it ships (Rust subprocess management, capability scope)
- Capabilities and permissions declared in `src-tauri/capabilities/` and `src-tauri/permissions/`

## Out of scope

- Issues in third-party LLM provider APIs (Anthropic, OpenAI, Gemini, etc.) — file with the provider directly.
- Issues in third-party MCP servers that a user installs — file with the MCP server's maintainer.
- Issues in upstream dependencies (Tauri, Vercel AI SDK, the `keyring` Rust crate, etc.) — file with that project; we will track and pull in the fix.

## What to expect

- This is early-development, single-author software. There is no SLA on response times.
- There are no release builds yet, no auto-updater, no code signing — any fix lands in `main` and rolls out the next time you build from source.
- A formal security advisory and CVE are appropriate once the project ships releases. Pre-release, fixes ship as ordinary commits referencing the report.

No PGP key required at this stage.
