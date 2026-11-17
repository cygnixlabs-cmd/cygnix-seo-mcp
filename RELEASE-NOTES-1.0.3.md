# cygnix-seo-mcp 1.0.3

Docs and CTA patch. The five local stdio tools, inputs and outputs are unchanged, except each tool response now also points at the hosted server.

- **Hosted CTA first:** README still leads with `https://mcp.cygnixlabs.com/mcp` and a free-key link (300 calls/month, no card) at https://mcp.cygnixlabs.com/#signup.
- **Plan names/prices** now match the live site on 16 Nov 2026 (https://mcp.cygnixlabs.com/#pricing): Free $0 (300 calls/month); Starter $15/mo; Pro $39/mo; Agency $99/mo. The pricing cards are also labelled Solo Starter, Teams Pro and Agencies Agency. This replaces the stale 1.0.2 wording "Pro $15 / Growth $39 / Agency $99, PayPal billing coming soon." PayPal subscribe buttons are on the site.
- **Startup notice** (stderr only; never stdout) still points at the hosted URL and free key, and now mentions those plan prices. Hide with `CYGNIX_QUIET=1`.
- **Tool responses** add one line: "Also available as a hosted MCP: https://mcp.cygnixlabs.com (free key)."
- `server.json` is 1.0.3 with the same remote `https://mcp.cygnixlabs.com/mcp` and free-key header note.
- Hosted server at publish prep time was **v1.2.1**. Local package remains free, five tools, no API key.
- **Not published yet.** Do not `npm publish` or `mcp-publisher publish` until the owner approves in his own words.
