# Cygnix SEO MCP: free SEO tools for Claude, Cursor & any MCP client

[![npm](https://img.shields.io/npm/v/cygnix-seo-mcp)](https://www.npmjs.com/package/cygnix-seo-mcp) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**5 no-API-key SEO tools** that work on *your* data: paste keywords, a Google Search Console export or your titles, and get clusters, intent, cannibalization fixes, CTR checks and content briefs. Everything is deterministic and runs locally. No accounts, no tracking, and no made-up search volumes.

Built by **[Cygnix Labs](https://cygnixlabs.com)**.

| Tool | What it does |
|---|---|
| `cluster_keywords` | Groups a keyword list into topical clusters and picks a pillar keyword per cluster (one cluster ≈ one page) |
| `classify_search_intent` | Labels keywords informational / commercial / transactional / navigational, with the matching signal |
| `find_keyword_cannibalization` | Reads GSC CSV (Query + Page) and flags queries where your own pages compete, ranked HIGH/MEDIUM/LOW, with a fix |
| `check_title_meta` | Scores title tags and meta descriptions (0–100): char + pixel truncation, keyword placement, CTR hooks |
| `content_brief_outline` | Builds a brief from your keyword: intent, title options, meta draft, slug, H2 outline, questions to answer, on-page checklist |

## Install

Requires Node.js 18+.

### Claude Desktop
Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):
```json
{
  "mcpServers": {
    "cygnix-seo": { "command": "npx", "args": ["-y", "cygnix-seo-mcp"] }
  }
}
```
Restart Claude Desktop.

### Cursor
Settings → MCP → Add new server, or add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):
```json
{
  "mcpServers": {
    "cygnix-seo": { "command": "npx", "args": ["-y", "cygnix-seo-mcp"] }
  }
}
```

### Claude Code
```bash
claude mcp add cygnix-seo -- npx -y cygnix-seo-mcp
```

### Other clients (VS Code, Windsurf, Cline, Zed…)
Any MCP client that supports stdio: command `npx`, args `-y cygnix-seo-mcp`.

### From source
```bash
git clone https://github.com/cygnixlabs-cmd/cygnix-seo-mcp && cd cygnix-seo-mcp
npm install && npm test
node dist/index.js
```

## Example prompts

- *"Cluster these 80 keywords and tell me which page each cluster should target:"* (paste list)
- *"Classify the search intent of these keywords and flag the commercial ones."*
- *"Here is my GSC export (query + page). Find keyword cannibalization and tell me what to merge."*
- *"Check the titles and meta descriptions for these 10 URLs against their target keywords."*
- *"Write a content brief for 'technical seo audit' using these related keywords: …"*

### Example output (cannibalization)
```
## [HIGH] "seo audit checklist" (2 pages, #2 page share 38%)
| Page | Clicks | Impr | Avg pos |
| https://site.com/a | 30 | 1000 | 4.2 |
| https://site.com/b | 5 | 600 | 9.1 |
Action: Pick https://site.com/a as canonical target; merge/301 or de-optimize the others...
```

**Getting GSC data:** Search Console → Performance → Search results → add the *Page* dimension alongside *Query* (or use the Looker Studio / API export) → Export CSV → paste the text.

## Honest limits
- Intent and clustering are rule-based/lexical, so treat them as a fast first pass and confirm with the live SERP.
- Title pixel widths are approximations of Google's SERP rendering.
- No tool estimates search volume or difficulty. Use your own data source for that.

## Paid pro tools
Need more than the free tools? These run in the cloud on Apify. You pay per result, and Claude, ChatGPT and Cursor agents can call them through the [Apify MCP server](https://mcp.apify.com):

| Tool | What it does | Price |
|---|---|---|
| [AEO & AI Search Readiness Checker](https://apify.com/cygnix_labs/aeo-readiness-checker) | Scores pages 0-100 for ChatGPT, Perplexity and AI Overviews: schema, answer-first content, FAQ, llms.txt, GPTBot/ClaudeBot access | 5 pages/run free, then $2 / 1,000 pages |
| [SERP Intent Mapper](https://apify.com/cygnix_labs/serp-intent-mapper) | Search intent + page type for every keyword | 100 keywords/run free, then $0.50 / 1,000 |
| [Keyword Clusterer + Content Brief](https://apify.com/cygnix_labs/keyword-clusterer-brief) | Topic clusters, pillar keywords, content briefs | 100 keywords/run free, then $0.70 / 1,000 + $0.01 / brief |
| [Keyword Cannibalization Finder](https://apify.com/cygnix_labs/keyword-cannibalization-finder) | Pages competing for the same query, from a GSC export | 3 issues/run free, then $0.007 / issue |
| [Content Decay Audit](https://apify.com/cygnix_labs/content-decay-audit) | Pages losing Google traffic, ranked by clicks lost, with refresh plans | 25 pages/run free, then $1 / 1,000 pages |

Full agent skills (Claude Code / Cursor SKILL.md packs): **[Cygnix Labs on Agensi](https://www.agensi.io/creators/cygnix-labs)**

## Want the full workflow?
These tools are the free starter layer of the **Cygnix SEO Toolkit**: full agent skills, prompts and sheets for keyword research → briefs → audits → content refresh.

- 🔎 [SEO Toolkit Vol. 1: Keyword Research → Content Refresh (Agensi)](https://www.agensi.io/bundles/seo-toolkit-keyword-research-to-content-refresh)
- 🛠️ [SEO Toolkit Vol. 2: Audit & Fix Pack (Agensi)](https://www.agensi.io/bundles/seo-toolkit-vol-2-audit-fix-pack)
- 📦 [SEO Operator Bundle (Gumroad)](https://cygnixlabs.gumroad.com/l/seo-operator-bundle)
- 👤 [All Cygnix Labs skills on Agensi](https://www.agensi.io/creators/cygnix-labs) · [Gumroad store](https://cygnixlabs.gumroad.com) · [Medium](https://medium.com/@cygnixlabs) · [X](https://x.com/cygnixlabs)

## Keywords
MCP server, Model Context Protocol, SEO MCP, keyword research, keyword clustering, search intent classifier, keyword cannibalization, Google Search Console, title tag checker, meta description length, CTR optimization, content brief generator, Claude SEO, Cursor SEO, AI SEO tools, free SEO tools, no API key.

## License
MIT © [Cygnix Labs](https://cygnixlabs.com)
