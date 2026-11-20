# cygnix-seo-mcp 1.0.4

CTA and notice patch. The five local stdio tools, their inputs and their outputs are unchanged apart from the footer line.

- **README** now opens with the hosted plan: free-key link (https://mcp.cygnixlabs.com/#signup, 300 calls/month, no card), the endpoint `https://mcp.cygnixlabs.com/mcp`, and the plan table from the live server code (Free 300 calls; Starter $15 / 5,000; Pro $39 / 25,000; Agency $99 / 100,000 + white-label PDFs).
- **Startup notice** (stderr only, one line, never stdout) is clearer: says the 5 local tools are ready, gives the hosted URL, the free-key link `/#signup`, "paid plans from $15/mo", and how to hide it (`CYGNIX_QUIET=1`).
- **Tool footer** links the hosted endpoint `/mcp` and the free-key page `/#signup` instead of the site root.
- `server.json` 1.0.4 (same remote `https://mcp.cygnixlabs.com/mcp`).
- Ships only the thin stdio client + 5 free local tools (`dist/index.js`, `dist/tools.js` + `.d.ts`), README, LICENSE, server.json. No hosted code.
- **Not published.** Do not push, `npm publish` or `mcp-publisher publish` until the owner approves in his own words.
