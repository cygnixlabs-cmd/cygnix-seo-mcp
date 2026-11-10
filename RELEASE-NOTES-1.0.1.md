# cygnix-seo-mcp 1.0.1

Patch release. Nothing changes for MCP clients: the same 5 tools, inputs and outputs.

- **New hosted version:** the README now points to `https://mcp.cygnixlabs.com/mcp`, a remote, no-install version for Claude, ChatGPT, Cursor, Claude Code and VS Code. It adds AI-search (AEO) readiness and llms.txt checks, and white-label PDF reports on the Agency plan. Free key (300 calls/month) at https://mcp.cygnixlabs.com. Live Google Search Console is coming soon.
- **Startup notice:** prints one line on **stderr** at startup (never stdout, so the stdio protocol is unaffected). Set `CYGNIX_QUIET=1` to hide it.
- **server.json:** adds the `streamable-http` remote for the hosted endpoint next to the npm package, and moves to the 2025-12-11 registry schema.
- **Dev:** fixed the `npm test` glob for Node 22+ and added tests that stdout stays clean.
