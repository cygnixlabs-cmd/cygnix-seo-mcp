#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clusterTool, intentTool, cannibalTool, titleMetaTool, briefTool } from "./tools.js";

const server = new McpServer({ name: "cygnix-seo-mcp", version: "1.0.0" });
const wrap = (f: () => string) => { try { return { content: [{ type: "text" as const, text: f() }] }; } catch (e) { return { isError: true, content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }] }; } };

server.tool("cluster_keywords", "Group a pasted keyword list (newline/comma separated) into topical clusters with a suggested pillar keyword per cluster. Deterministic; no search volumes.",
  { keywords: z.string().describe("Keywords, one per line or comma separated"), min_shared_terms: z.number().int().min(1).max(3).optional() },
  async ({ keywords, min_shared_terms }) => wrap(() => clusterTool(keywords, min_shared_terms ?? 1)));
server.tool("classify_search_intent", "Classify keywords as informational, commercial, transactional or navigational using modifier rules.",
  { keywords: z.string().describe("Keywords, one per line or comma separated") },
  async ({ keywords }) => wrap(() => intentTool(keywords)));
server.tool("find_keyword_cannibalization", "Find queries where 2+ of your pages compete, from a Google Search Console export (CSV/TSV text with Query and Page columns; clicks, impressions, position optional).",
  { gsc_csv: z.string().describe("Pasted GSC CSV text including header row"), min_impressions: z.number().int().min(0).optional() },
  async ({ gsc_csv, min_impressions }) => wrap(() => cannibalTool(gsc_csv, min_impressions ?? 10)));
server.tool("check_title_meta", "Check title tags and meta descriptions for length/pixel truncation, keyword placement and CTR hooks. Returns a 0-100 score with fixes.",
  { items: z.array(z.object({ title: z.string(), meta: z.string().optional(), keyword: z.string().optional(), url: z.string().optional() })).min(1).max(100) },
  async ({ items }) => wrap(() => titleMetaTool(items)));
server.tool("content_brief_outline", "Generate a content brief (intent, title options, meta draft, H2 outline, questions, on-page checklist) for a target keyword plus optional related keywords.",
  { keyword: z.string(), related_keywords: z.string().optional(), audience: z.string().optional(), word_count: z.number().int().min(300).max(10000).optional() },
  async ({ keyword, related_keywords, audience, word_count }) => wrap(() => briefTool(keyword, related_keywords, audience, word_count)));

await server.connect(new StdioServerTransport());
