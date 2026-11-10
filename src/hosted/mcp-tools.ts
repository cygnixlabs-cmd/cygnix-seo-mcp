// Hosted-only MCP tools: account status, Google Search Console, AEO / llms.txt, white-label PDF reports.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ANNOTATIONS } from "../annotations.js";
import type { Principal } from "./auth.js";
import type { Store } from "./store.js";
import { periodOf, periodResetIso } from "./store.js";
import { baseUrl, upgradeUrl, accountUrl, type HostedEnv } from "./env.js";
import { TIERS, nextTier } from "./tiers.js";
import { GoogleClient, GoogleError, connectUrl, googleConfigured } from "./google.js";
import { runAeoCheck, runLlmsCheck, assertPublicUrl } from "./aeo.js";
import { renderReportPdf, sniffImage, validColor } from "./report.js";
import { cannibalization } from "../tools.js";
import { b64encode, randomToken } from "./crypto.js";

export interface ToolCtx { principal: Principal; store: Store; env: HostedEnv; fetchImpl: typeof fetch; webFetch: typeof fetch;
  /** true for clients such as ChatGPT: no prices, plan offers or upgrade links; only "not on your plan" + the informational account page. */
  hidePrices?: boolean }
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ isError: true, content: [{ type: "text" as const, text: t }] });
const guard = <A>(f: (a: A) => Promise<string>) => async (a: A) => { try { return text(await f(a)); } catch (e) { return fail(`Error: ${(e as Error).message}`); } };
const csvq = (v: string) => `"${v.replace(/"/g, '""')}"`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

export function registerHostedTools(server: McpServer, c: ToolCtx) {
  const tier = TIERS[c.principal.tier]; const hide = !!c.hidePrices;
  server.tool("account_status", hide ? "Show this Cygnix key's current plan, monthly tool-call usage and limits." : "Show this Cygnix API key's plan, monthly tool-call usage, limits and upgrade options.", {}, ANNOTATIONS["account_status"], guard(async () => {
    const used = await c.store.accountUsage(c.principal.accountId); const nt = nextTier(tier.id);
    const g = await c.store.google(c.principal.keyId);
    if (hide) return [`Plan: ${tier.name}`, `Usage ${periodOf()}: ${used} / ${tier.monthlyCalls} tool calls (resets ${periodResetIso()})`,
      `Rate limit: ${tier.perMinute} requests/minute; keys allowed: ${tier.maxKeys}`, `Google Search Console: ${g ? "connected" : googleConfigured(c.env) ? "not connected (use gsc_connect)" : "not available yet"}`,
      `White-label PDF reports: ${tier.whiteLabelReports ? "included" : "not included in this plan"}`, `Account details: ${accountUrl(c.env)}`].join("\n");
    return [`Plan: ${tier.name} ($${tier.priceUsdMonthly}/mo)`, `Usage ${periodOf()}: ${used} / ${tier.monthlyCalls} tool calls (resets ${periodResetIso()})`,
      `Rate limit: ${tier.perMinute} requests/minute; keys allowed: ${tier.maxKeys}`, `Google Search Console: ${g ? "connected" : googleConfigured(c.env) ? "not connected (use gsc_connect)" : "not available yet"}`,
      `White-label PDF reports: ${tier.whiteLabelReports ? "included" : "Agency plan"}`, nt ? `Upgrade: ${nt.name} $${nt.priceUsdMonthly}/mo = ${nt.monthlyCalls.toLocaleString("en-US")} calls -> ${upgradeUrl(c.env)}` : "You are on the top plan."].join("\n");
  }));

  // ---- AEO / AI search ----
  server.tool("check_ai_search_readiness", "AEO / AI-search visibility audit for one public URL: checks whether ChatGPT search, Claude, Perplexity, Copilot and Google AI Overviews crawlers are allowed, plus schema, answer-ready structure, server-rendered text, freshness and llms.txt. Returns a 0-100 score and prioritized fixes.",
    { url: z.string().describe("Public page URL, e.g. https://example.com/pricing") }, ANNOTATIONS["check_ai_search_readiness"], guard(async ({ url }) => (await runAeoCheck(c.webFetch, url)).markdown));
  server.tool("check_llms_txt", "Check a site's /llms.txt (and /llms-full.txt) against the llmstxt.org format: H1, summary, sections, link syntax, absolute URLs, descriptions. Returns issues or a starter file.",
    { url: z.string().describe("Any URL on the site; the origin is used") }, ANNOTATIONS["check_llms_txt"], guard(async ({ url }) => runLlmsCheck(c.webFetch, url)));

  // ---- Google Search Console (only when Google OAuth is configured) ----
  if (googleConfigured(c.env)) {
    const g = new GoogleClient(c.env, c.store, c.fetchImpl);
    const gsc = <A>(f: (a: A) => Promise<string>) => async (a: A) => { try { return text(await f(a)); } catch (e) {
      if (e instanceof GoogleError && e.code === "not_connected") return fail(`${e.message}\nConnect link: ${await connectUrl(c.env, c.principal.keyId)}`);
      return fail(`Error: ${(e as Error).message}`); } };
    server.tool("gsc_connect", "Get a one-click link to connect Google Search Console (read-only) to this Cygnix key. Open it, approve, then use the gsc_* tools.", {}, ANNOTATIONS["gsc_connect"],
      guard(async () => `Open this link to connect Google Search Console (read-only, revocable any time):\n${await connectUrl(c.env, c.principal.keyId)}\n\nThe link expires in 15 minutes.`));
    server.tool("gsc_list_sites", "List the Search Console properties the connected Google account can read.", {}, ANNOTATIONS["gsc_list_sites"], gsc(async () => {
      const r = await g.listSites(c.principal.keyId); const s = r.siteEntry ?? [];
      return s.length ? `| Property | Permission |\n|---|---|\n${s.map(x => `| ${x.siteUrl} | ${x.permissionLevel} |`).join("\n")}` : "No Search Console properties found for this Google account.";
    }));
    server.tool("gsc_search_analytics", "Query Search Console performance (clicks, impressions, CTR, position) for a property, grouped by query, page, country, device or date.",
      { site_url: z.string().describe("Property exactly as listed by gsc_list_sites, e.g. sc-domain:example.com or https://example.com/"),
        start_date: z.string().optional().describe("YYYY-MM-DD, default 28 days ago"), end_date: z.string().optional().describe("YYYY-MM-DD, default 2 days ago"),
        dimensions: z.array(z.enum(["query", "page", "country", "device", "date", "searchAppearance"])).max(3).optional(),
        query_contains: z.string().optional(), page_contains: z.string().optional(), row_limit: z.number().int().min(1).max(1000).optional() }, ANNOTATIONS["gsc_search_analytics"],
      gsc(async a => {
        const filters = [a.query_contains && { dimension: "query", operator: "contains", expression: a.query_contains }, a.page_contains && { dimension: "page", operator: "contains", expression: a.page_contains }].filter(Boolean);
        const dims = a.dimensions ?? ["query"];
        const r = await g.searchAnalytics(c.principal.keyId, a.site_url, { startDate: a.start_date ?? daysAgo(28), endDate: a.end_date ?? daysAgo(2), dimensions: dims, rowLimit: a.row_limit ?? 50,
          ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}) });
        const rows = r.rows ?? []; if (!rows.length) return "No rows for that range/filter.";
        return `| ${dims.join(" | ")} | Clicks | Impr. | CTR | Pos. |\n|${"---|".repeat(dims.length + 4)}\n` + rows.map(x => `| ${x.keys.join(" | ")} | ${x.clicks} | ${x.impressions} | ${(x.ctr * 100).toFixed(1)}% | ${x.position.toFixed(1)} |`).join("\n");
      }));
    server.tool("gsc_find_cannibalization", "Pull live query+page data from Search Console and list queries where 2+ of your pages compete, with a keep/merge suggestion.",
      { site_url: z.string(), days: z.number().int().min(7).max(480).optional(), min_impressions: z.number().int().min(0).optional() }, ANNOTATIONS["gsc_find_cannibalization"],
      gsc(async a => {
        const r = await g.searchAnalytics(c.principal.keyId, a.site_url, { startDate: daysAgo((a.days ?? 90) + 2), endDate: daysAgo(2), dimensions: ["query", "page"], rowLimit: 25000 });
        const csv = "query,page,clicks,impressions,position\n" + (r.rows ?? []).map(x => [csvq(x.keys[0]), csvq(x.keys[1]), x.clicks, x.impressions, x.position.toFixed(1)].join(",")).join("\n");
        const res = cannibalization(csv, a.min_impressions ?? 10);
        if (!res.length) return `No cannibalization found in ${r.rows?.length ?? 0} query-page rows.`;
        return `# Live cannibalization: ${a.site_url} (last ${a.days ?? 90} days)\n\n` + res.slice(0, 50).map(x => `## ${x.query} (${x.severity})\n${x.pages.map(p => `- ${p.page}: ${p.clicks} clicks, ${p.impr} impr., pos ${p.pos.toFixed(1)}`).join("\n")}\nAction: ${x.action}`).join("\n\n");
      }));
    server.tool("gsc_inspect_url", "Inspect one URL with the Search Console URL Inspection API: index status, coverage, canonical, last crawl, mobile usability.",
      { site_url: z.string(), url: z.string() }, ANNOTATIONS["gsc_inspect_url"], gsc(async a => {
        const r = await g.inspectUrl(c.principal.keyId, a.site_url, a.url); const i = r.inspectionResult?.indexStatusResult ?? {};
        return [`URL: ${a.url}`, `Verdict: ${i.verdict ?? "?"}`, `Coverage: ${i.coverageState ?? "?"}`, `Indexing state: ${i.indexingState ?? "?"}`, `Robots.txt: ${i.robotsTxtState ?? "?"}`,
          `Last crawl: ${i.lastCrawlTime ?? "?"} (${i.crawledAs ?? "?"})`, `Google canonical: ${i.googleCanonical ?? "?"}`, `User canonical: ${i.userCanonical ?? "?"}`].join("\n");
      }));
    server.tool("gsc_disconnect", "Disconnect Google Search Console from this key and revoke the stored token.", {}, ANNOTATIONS["gsc_disconnect"], guard(async () => (await g.disconnect(c.principal.keyId)) ? "Disconnected and revoked." : "Nothing was connected."));
  }

  // ---- White-label reports (Agency) ----
  const agencyOnly = () => tier.whiteLabelReports ? null : fail(hide
    ? `White-label PDF reports are not included in this key's current plan. See your account page: ${accountUrl(c.env)}`
    : `White-label PDF reports are part of the Agency plan ($${TIERS.agency.priceUsdMonthly}/mo). Upgrade: ${upgradeUrl(c.env)}`);
  const agencyLabel = hide ? "Agency accounts" : "Agency plan";
  server.tool("set_report_branding", `${agencyLabel}: set the white-label branding used on PDF reports (agency name, logo URL, colours, footer).`,
    { agency_name: z.string().min(1).max(80), logo_url: z.string().url().optional().describe("Public PNG or JPG"), primary_color: z.string().optional().describe("#RRGGBB"),
      accent_color: z.string().optional().describe("#RRGGBB"), footer_text: z.string().max(140).optional(), website: z.string().max(120).optional() }, ANNOTATIONS["set_report_branding"],
    async a => { const d = agencyOnly(); if (d) return d;
      if ((a.primary_color && !validColor(a.primary_color)) || (a.accent_color && !validColor(a.accent_color))) return fail("Colours must be #RRGGBB.");
      if (a.logo_url) { try { assertPublicUrl(a.logo_url); } catch (e) { return fail((e as Error).message); } }
      await c.store.saveBranding(c.principal.accountId, { agency_name: a.agency_name, logo_url: a.logo_url ?? null, primary_color: a.primary_color ?? "#1F3A5F", accent_color: a.accent_color ?? "#F2A541", footer_text: a.footer_text ?? null, website: a.website ?? null });
      return text(`Branding saved for ${a.agency_name}. New reports from any key on this account will use it.`); });
  server.tool("create_white_label_report", `${agencyLabel}: turn Markdown (e.g. the output of other Cygnix tools) into a client-ready PDF with your agency's logo, colours and name. Returns a private download link valid 30 days.`,
    { title: z.string().min(1).max(90), client_name: z.string().max(80).optional(), content_markdown: z.string().min(1).max(200_000) }, ANNOTATIONS["create_white_label_report"],
    async a => { const d = agencyOnly(); if (d) return d;
      try {
        const b = await c.store.branding(c.principal.accountId);
        if (!b) return fail("Set your branding first with set_report_branding (agency name, logo, colours).");
        let logo: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
        if (b.logo_url) { try { const r = await c.webFetch(assertPublicUrl(b.logo_url).toString()); const bytes = new Uint8Array(await r.arrayBuffer()); const t = sniffImage(bytes); if (t && bytes.length < 2_000_000) logo = { bytes, type: t }; } catch { logo = null; } }
        const pdf = await renderReportPdf({ branding: b, title: a.title, clientName: a.client_name, markdown: a.content_markdown, logo });
        if (pdf.length > 1_500_000) return fail("Report is too large; split the content into smaller reports.");
        const id = `rpt_${randomToken(28)}`;
        await c.store.saveReport(id, c.principal.accountId, c.principal.keyId, a.title, b64encode(pdf));
        return text(`PDF ready (${Math.round(pdf.length / 1024)} KB, ${b.agency_name} branding): ${baseUrl(c.env)}/reports/${id}.pdf\nThe link is private and expires in 30 days.${logo ? "" : b.logo_url ? "\n(Logo could not be loaded; use a public PNG/JPG under 2 MB.)" : ""}`);
      } catch (e) { return fail(`Error: ${(e as Error).message}`); } });
}
