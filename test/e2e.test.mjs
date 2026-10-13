import test from "node:test"; import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
test("stdio server lists and runs all 5 tools", async () => {
  const c = new Client({ name: "t", version: "1" }); await c.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));
  const { tools } = await c.listTools(); assert.equal(tools.length, 5);
  const calls = { cluster_keywords: { keywords: "seo audit, seo audit tool, content brief" }, classify_search_intent: { keywords: "buy seo pack" },
    find_keyword_cannibalization: { gsc_csv: "query,page,clicks,impressions\nx,/a,5,100\nx,/b,4,90" }, check_title_meta: { items: [{ title: "SEO Audit Checklist (2026)" }] },
    content_brief_outline: { keyword: "seo audit" } };
  for (const [name, args] of Object.entries(calls)) { const r = await c.callTool({ name, arguments: args }); assert.ok(!r.isError, name); assert.match(r.content[0].text, /Full workflow: Cygnix SEO Toolkit on Agensi/); }
  await c.close();
});
