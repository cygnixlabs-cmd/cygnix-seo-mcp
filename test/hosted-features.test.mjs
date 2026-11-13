import test from "node:test"; import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { makeApp, mockFetch } from "./helpers.mjs";
import { parseRobots, robotsAllows, aeoReport, analyzeLlmsTxt, assertPublicUrl } from "../dist/hosted/aeo.js";
import { encryptString, decryptString } from "../dist/hosted/crypto.js";
import { renderReportPdf, winAnsi } from "../dist/hosted/report.js";

const GOOGLE = { GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "gsecret", TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
const names = r => r.body.result.tools.map(t => t.name);

test("Google OAuth is inert without env: no gsc_* tools, connect endpoint 503", async () => {
  const { signup, rpc, post } = makeApp();
  const s = await signup();
  assert.ok(!names(await rpc(s.api_key, "tools/list")).some(n => n.startsWith("gsc_")));
  assert.equal((await post("/v1/google/connect", {}, { authorization: `Bearer ${s.api_key}` })).status, 503);
});

test("AES-GCM token encryption round-trips and rejects a wrong key", async () => {
  const k = GOOGLE.TOKEN_ENCRYPTION_KEY; const blob = await encryptString(k, "1//refresh-token");
  assert.ok(!blob.includes("refresh")); assert.equal(await decryptString(k, blob), "1//refresh-token");
  await assert.rejects(decryptString(randomBytes(32).toString("base64"), blob));
});

test("GSC: connect link -> callback stores encrypted refresh token -> gsc tools use it", async () => {
  const f = mockFetch([
    ["https://oauth2.googleapis.com/token", (u, i) => { const p = new URLSearchParams(i.body);
      if (p.get("grant_type") === "authorization_code") return { access_token: "ya29.a", refresh_token: "1//rt-secret", scope: "https://www.googleapis.com/auth/webmasters.readonly", expires_in: 3599 };
      assert.equal(p.get("refresh_token"), "1//rt-secret"); return { access_token: "ya29.b", expires_in: 3599 }; }],
    ["https://www.googleapis.com/webmasters/v3/sites/", (u, i) => { assert.equal(i.headers.Authorization, "Bearer ya29.b");
      return { rows: [{ keys: ["seo audit", "https://ex.com/a"], clicks: 10, impressions: 400, ctr: 0.025, position: 4.2 }, { keys: ["seo audit", "https://ex.com/b"], clicks: 6, impressions: 300, ctr: 0.02, position: 6.1 }] }; }],
    ["https://www.googleapis.com/webmasters/v3/sites", () => ({ siteEntry: [{ siteUrl: "sc-domain:ex.com", permissionLevel: "siteOwner" }] })],
  ]);
  const { signup, rpc, call, req, db } = makeApp(GOOGLE, { fetchImpl: f });
  const s = await signup();
  assert.ok(names(await rpc(s.api_key, "tools/list")).includes("gsc_search_analytics"));
  const notConnected = await call(s.api_key, "gsc_list_sites");
  assert.equal(notConnected.body.result.isError, true); assert.match(notConnected.body.result.content[0].text, /accounts\.google\.com/);
  const link = (await call(s.api_key, "gsc_connect")).body.result.content[0].text.match(/https:\/\/accounts\.google\.com\S+/)[0];
  const u = new URL(link); assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/webmasters.readonly"); assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("redirect_uri"), "https://mcp.test/google/callback");
  const forged = await req(`/google/callback?code=abc&state=${encodeURIComponent(u.searchParams.get("state").replace(/.$/, c => c === "0" ? "1" : "0"))}`);
  assert.equal(forged.status, 400);
  const cb = await req(`/google/callback?code=abc&state=${encodeURIComponent(u.searchParams.get("state"))}`);
  assert.equal(cb.status, 200); assert.match(await cb.text(), /Search Console connected/);
  const row = await db.prepare("SELECT refresh_token_enc FROM google_connections").first();
  assert.ok(row && !row.refresh_token_enc.includes("rt-secret"), "refresh token stored encrypted");
  assert.match((await call(s.api_key, "gsc_list_sites")).body.result.content[0].text, /sc-domain:ex\.com/);
  assert.match((await call(s.api_key, "gsc_search_analytics", { site_url: "sc-domain:ex.com", dimensions: ["query", "page"] })).body.result.content[0].text, /seo audit \| https:\/\/ex\.com\/a \| 10 \| 400 \| 2\.5%/);
  const cann = (await call(s.api_key, "gsc_find_cannibalization", { site_url: "sc-domain:ex.com" })).body.result.content[0].text;
  assert.match(cann, /## seo audit \(HIGH\)/);
});

test("robots.txt parsing: specific groups, wildcard fallback, longest match", () => {
  const g = parseRobots("User-agent: *\nDisallow: /private\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /\nAllow: /blog/");
  assert.equal(robotsAllows(g, "GPTBot", "/"), false); assert.equal(robotsAllows(g, "CCBot", "/x"), false);
  assert.equal(robotsAllows(g, "OAI-SearchBot", "/"), true); assert.equal(robotsAllows(g, "OAI-SearchBot", "/private/a"), false);
  assert.equal(robotsAllows(g, "PerplexityBot", "/blog/post"), true); assert.equal(robotsAllows(g, "PerplexityBot", "/pricing"), false);
});

test("AEO report scores a strong page higher than a blocked JS shell", () => {
  const good = `<html><head><title>SEO Audit Pricing</title><meta name="description" content="Plans from $15"><link rel="canonical" href="https://ex.com/p"><meta name="author" content="A"><meta property="article:modified_time" content="2026-11-01">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":["Organization","FAQPage"]}</script></head><body><h1>SEO audit pricing</h1><p>Our SEO audit costs $99 and ships in 48 hours.</p>
    <h2>How much does an SEO audit cost?</h2><p>${"word ".repeat(200)}</p><h2>What is included?</h2><ul><li>a</li></ul><h3>Timeline</h3><p>${"more ".repeat(150)}</p></body></html>`;
  const shell = `<html><head><meta name="robots" content="noindex"></head><body><div id="root"></div><script>app()</script></body></html>`;
  const a = aeoReport({ url: "https://ex.com/p", status: 200, html: good, robotsTxt: "User-agent: GPTBot\nDisallow: /", llmsTxtFound: true });
  const b = aeoReport({ url: "https://ex.com/p", status: 200, html: shell, robotsTxt: "User-agent: *\nDisallow: /", llmsTxtFound: false });
  assert.ok(a.score >= 90, `good page scored ${a.score}`); assert.ok(b.score <= 30, `shell scored ${b.score}`);
  assert.match(a.markdown, /\| GPTBot \| OpenAI \| training \| \*\*NO\*\* \|/); assert.match(b.markdown, /server-render/);
});

test("llms.txt validator flags format problems", () => {
  const good = analyzeLlmsTxt("# Cygnix\n\n> SEO tools for agencies.\n\n## Docs\n\n- [Pricing](https://ex.com/pricing): plans\n- [Connect](https://ex.com/connect): setup\n");
  assert.equal(good.issues.length, 0);
  const bad = analyzeLlmsTxt("Cygnix\n## Docs\n- pricing page\n- [Rel](/rel)\n# Second\n");
  assert.ok(bad.issues.length >= 4, bad.issues.join(" | "));
});

test("AEO and llms.txt tools fetch only public URLs (mocked web)", async () => {
  assert.throws(() => assertPublicUrl("http://127.0.0.1/x")); assert.throws(() => assertPublicUrl("http://localhost:8787")); assert.throws(() => assertPublicUrl("file:///etc/passwd"));
  assert.throws(() => assertPublicUrl("http://169.254.169.254/latest")); assert.equal(assertPublicUrl("ex.com").href, "https://ex.com/");
  const web = mockFetch([
    ["https://ex.com/robots.txt", () => new Response("User-agent: *\nAllow: /")],
    ["https://ex.com/llms.txt", () => new Response("# Ex\n\n> Summary\n\n## Pages\n\n- [Home](https://ex.com/): home\n")],
    ["https://ex.com/llms-full.txt", () => new Response("nope", { status: 404 })],
    ["https://ex.com/", () => new Response("<html><title>Ex</title><h1>Ex</h1><p>hello</p></html>", { headers: { "content-type": "text/html" } })],
  ]);
  const { signup, call } = makeApp({}, { webFetch: web });
  const s = await signup();
  const aeo = await call(s.api_key, "check_ai_search_readiness", { url: "https://ex.com/" });
  assert.match(aeo.body.result.content[0].text, /AI-search visibility \(AEO\) check/);
  const llms = await call(s.api_key, "check_llms_txt", { url: "ex.com" });
  assert.match(llms.body.result.content[0].text, /\*\*Found\*\*/); assert.match(llms.body.result.content[0].text, /llms-full\.txt: not found/);
  const ssrf = await call(s.api_key, "check_ai_search_readiness", { url: "http://10.0.0.5/admin" });
  assert.equal(ssrf.body.result.isError, true);
});

test("white-label PDF: Agency only, branded, downloadable", async () => {
  const { signup, call, store, req } = makeApp();
  const s = await signup();
  const denied = await call(s.api_key, "create_white_label_report", { title: "Audit", content_markdown: "# Hi" });
  assert.equal(denied.body.result.isError, true); assert.match(denied.body.result.content[0].text, /Agency plan/);
  await store.setTier(s.account_id, "agency");
  assert.match((await call(s.api_key, "create_white_label_report", { title: "Audit", content_markdown: "# Hi" })).body.result.content[0].text, /set_report_branding/);
  assert.equal((await call(s.api_key, "set_report_branding", { agency_name: "Acme SEO", primary_color: "red" })).body.result.isError, true);
  await call(s.api_key, "set_report_branding", { agency_name: "Acme SEO", primary_color: "#112233", accent_color: "#FF8800", footer_text: "Confidential – prepared by Acme", website: "acme.example" });
  const md = "# Technical audit\n\n> Summary — 3 fixes\n\n## Findings\n\n| Check | Result |\n|---|---|\n| Title | OK |\n\n- **Fix** canonical\n1. Add schema\n\n```\ncode\n```\n" + "Long paragraph text. ".repeat(400);
  const r = await call(s.api_key, "create_white_label_report", { title: "Q4 SEO report", client_name: "Client Co", content_markdown: md });
  const url = r.body.result.content[0].text.match(/https:\/\/mcp\.test\/reports\/(rpt_\w+)\.pdf/);
  assert.ok(url, r.body.result.content[0].text);
  const pdf = await req(`/reports/${url[1]}.pdf`);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  const bytes = new Uint8Array(await pdf.arrayBuffer()); assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const { PDFDocument } = await import("pdf-lib"); const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getAuthor(), "Acme SEO"); assert.equal(doc.getTitle(), "Q4 SEO report"); assert.ok(doc.getPageCount() >= 2, "long content paginates");
  assert.equal((await req("/reports/rpt_doesnotexist.pdf")).status, 404);
});

test("PDF renderer handles non-Latin text without throwing", async () => {
  assert.equal(winAnsi("“Smart” — quotes… ✓ 日本"), '"Smart" - quotes...  ');
  const pdf = await renderReportPdf({ branding: { agency_name: "A", primary_color: "#000000", accent_color: "#ffffff" }, title: "T ✓", markdown: "# 日本語\n- ✓ done" });
  assert.ok(pdf.length > 500);
});

test("every tool has a title and explicit read-only/destructive/open-world hints (directory requirement)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { signup, rpc, req } = makeApp({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
  const s = await signup();
  const tools = (await rpc(s.api_key, "tools/list")).body.result.tools;
  assert.equal(tools.length, 16);
  for (const t of tools) {
    assert.ok(t.annotations?.title, `${t.name} title`);
    for (const h of ["readOnlyHint", "destructiveHint", "openWorldHint"]) assert.equal(typeof t.annotations[h], "boolean", `${t.name} ${h}`);
    assert.ok(t.name.length <= 64);
  }
  assert.equal(tools.find(t => t.name === "gsc_disconnect").annotations.destructiveHint, true);
  const card = await (await req("/.well-known/mcp/server-card.json")).json();
  assert.equal(card.tools.length, 16); assert.equal(card.authentication.required, true);
});

test("without Google OAuth the server instructions say Search Console is coming soon", async () => {
  const { signup, rpc } = makeApp();
  const s = await signup();
  const init = await rpc(s.api_key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.match(init.body.result.instructions, /coming soon/);
});
