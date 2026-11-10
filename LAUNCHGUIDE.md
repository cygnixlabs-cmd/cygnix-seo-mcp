# Cygnix SEO MCP

## Tagline
AEO and SEO tools for Claude and ChatGPT: AI-search readiness, llms.txt, keywords, briefs.

## Description
Cygnix SEO MCP is a hosted remote MCP server (Streamable HTTP) for SEOs, marketers and agencies. Your AI assistant can check whether ChatGPT search, Perplexity, Claude and Google AI Overviews can reach and cite a page, and get a 0–100 score with prioritized fixes. It can validate and draft llms.txt, cluster keyword lists into pages, classify search intent, find keyword cannibalization in a Search Console export, score titles and meta descriptions for truncation and CTR, and generate content briefs. The Agency plan adds white-label PDF reports with your logo and colours, and one key per client with a pooled quota. A live, read-only Google Search Console connection is coming soon. There is a free tier (300 tool calls a month). Sign in with OAuth (paste your Cygnix key) or send an `Authorization: Bearer` header.

## Setup Requirements
- `CYGNIX_API_KEY` (required): free API key from https://mcp.cygnixlabs.com/#signup. OAuth clients (Claude, ChatGPT) ask for it on the sign-in page; header-based clients send `Authorization: Bearer <key>`.

## Category
Marketing & Social

## Features
- AI-search (AEO) readiness score for any public URL: AI crawler access (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Bingbot, Googlebot), schema, answer-ready structure, server-rendered text
- llms.txt validation against the llmstxt.org format, plus a starter file
- Keyword clustering into pages with a pillar keyword per cluster
- Search intent classification (informational, commercial, transactional, navigational)
- Keyword cannibalization from a Google Search Console CSV export
- Title and meta description checks: pixel truncation, keyword placement, CTR hooks
- Content brief outlines: titles, meta, H2 outline, questions, on-page checklist
- White-label PDF reports with your logo, colours and agency name (Agency plan)
- One API key per client with pooled monthly quota (Agency plan)
- Free tier: 300 tool calls a month, every tool included
- Live Google Search Console connection: coming soon

## Getting Started
- "Can ChatGPT and Perplexity cite https://example.com/pricing? Fix what blocks them."
- "Check the llms.txt on example.com and write a better one."
- "Cluster these keywords into pages and tell me the pillar for each: …"
- Tool: check_ai_search_readiness — scores a page's AI-search visibility and lists fixes
- Tool: check_llms_txt — validates /llms.txt and /llms-full.txt
- Tool: create_white_label_report — branded client PDF (Agency)

## Tags
seo, aeo, geo, ai-search, llms-txt, keyword-research, keyword-clustering, search-intent, keyword-cannibalization, meta-description, title-tag, content-brief, google-search-console, agency, white-label, seo-audit, chatgpt, claude, ai-overviews, perplexity

## Documentation URL
https://mcp.cygnixlabs.com/connect.html

## Health Check URL
https://mcp.cygnixlabs.com/health
