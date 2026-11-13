// MCP tool annotations required by the Claude and ChatGPT directories (title + readOnly/destructive/openWorld hints).
// openWorldHint follows the ChatGPT review meaning: true only if the tool changes public internet state or third-party
// systems. Our tools only read public pages / Google data, so every tool is false. Reading is not "open world" writing.
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
const ro = (title: string): ToolAnnotations => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const write = (title: string, destructive = false): ToolAnnotations => ({ title, readOnlyHint: false, destructiveHint: destructive, idempotentHint: false, openWorldHint: false });
export const ANNOTATIONS: Record<string, ToolAnnotations> = {
  cluster_keywords: ro("Cluster keywords"),
  classify_search_intent: ro("Classify search intent"),
  find_keyword_cannibalization: ro("Find keyword cannibalization (CSV)"),
  check_title_meta: ro("Check title and meta description"),
  content_brief_outline: ro("Content brief outline"),
  account_status: ro("Account status and usage"),
  check_ai_search_readiness: ro("Check AI-search (AEO) readiness"),
  check_llms_txt: ro("Check llms.txt"),
  gsc_connect: ro("Connect Google Search Console"),
  gsc_list_sites: ro("List Search Console sites"),
  gsc_search_analytics: ro("Search Console performance"),
  gsc_find_cannibalization: ro("Find cannibalization (Search Console)"),
  gsc_inspect_url: ro("Inspect URL (Search Console)"),
  gsc_disconnect: write("Disconnect Search Console", true),          // revokes access
  set_report_branding: write("Set report branding", true),           // overwrites previous branding
  create_white_label_report: write("Create white-label PDF report"),  // stores a private PDF
};
