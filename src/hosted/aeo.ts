// AEO / AI-search visibility and llms.txt checks. Analyzers are pure functions over fetched text;
// safeFetch only reaches public http(s) URLs with a size cap and timeout.
export const AI_BOTS: { ua: string; owner: string; role: "answer" | "training" | "user" }[] = [
  { ua: "OAI-SearchBot", owner: "OpenAI", role: "answer" }, { ua: "ChatGPT-User", owner: "OpenAI", role: "user" }, { ua: "GPTBot", owner: "OpenAI", role: "training" },
  { ua: "Claude-SearchBot", owner: "Anthropic", role: "answer" }, { ua: "Claude-User", owner: "Anthropic", role: "user" }, { ua: "ClaudeBot", owner: "Anthropic", role: "training" },
  { ua: "PerplexityBot", owner: "Perplexity", role: "answer" }, { ua: "Perplexity-User", owner: "Perplexity", role: "user" },
  { ua: "Googlebot", owner: "Google (Search + AI Overviews)", role: "answer" }, { ua: "Google-Extended", owner: "Google (Gemini training)", role: "training" },
  { ua: "Bingbot", owner: "Microsoft (Bing + Copilot)", role: "answer" }, { ua: "Applebot-Extended", owner: "Apple Intelligence", role: "training" },
  { ua: "CCBot", owner: "Common Crawl", role: "training" }, { ua: "meta-externalagent", owner: "Meta AI", role: "training" },
];

// ---------- robots.txt ----------
interface Group { agents: string[]; rules: { allow: boolean; path: string }[] }
export function parseRobots(txt: string): Group[] {
  const groups: Group[] = []; let cur: Group | null = null; let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v });
  }
  return groups;
}
const ruleRe = (p: string) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
export function robotsAllows(groups: Group[], ua: string, path = "/"): boolean {
  const u = ua.toLowerCase();
  let g = groups.filter(x => x.agents.some(a => a !== "*" && u.includes(a)));
  if (!g.length) g = groups.filter(x => x.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const r of g.flatMap(x => x.rules)) {
    if (r.path === "") { continue; }
    if (ruleRe(r.path).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

// ---------- page signals ----------
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
const metaContent = (html: string, re: RegExp) => { const tag = html.match(re)?.[0]; return tag?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? null; };
export function analyzePage(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const metaDesc = metaContent(html, /<meta[^>]+name\s*=\s*["']description["'][^>]*>/i);
  const robotsMeta = (metaContent(html, /<meta[^>]+name\s*=\s*["'](?:robots|googlebot)["'][^>]*>/i) || "").toLowerCase();
  const canonical = /<link[^>]+rel\s*=\s*["']canonical["'][^>]*>/i.test(html);
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  const headings = [...html.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => strip(m[2]));
  const questionHeadings = headings.filter(h => /\?$|^(how|what|why|when|where|who|which|can|does|is|are|should)\b/i.test(h)).length;
  const lists = (html.match(/<(ul|ol)[\s>]/gi) || []).length, tables = (html.match(/<table[\s>]/gi) || []).length;
  const jsonLd = [...html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const schemaTypes = new Set<string>();
  for (const block of jsonLd) { for (const t of block.matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) for (const x of t[1].matchAll(/"([^"]+)"/g)) schemaTypes.add(x[1]); }
  const text = strip(html); const words = text ? text.split(" ").length : 0;
  const dated = /article:(published|modified)_time|"date(Published|Modified)"|<time[\s>]/i.test(html);
  const author = /<meta[^>]+name\s*=\s*["']author["']|"author"\s*:|rel\s*=\s*["']author["']/i.test(html);
  const firstP = strip(html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
  return { title, metaDesc, robotsMeta, canonical, h1, headings: headings.length, questionHeadings, lists, tables, schemaTypes: [...schemaTypes], words, dated, author, firstParagraphWords: firstP ? firstP.split(" ").length : 0 };
}

export interface AeoInput { url: string; status: number; html: string; robotsTxt: string | null; llmsTxtFound: boolean }
export function aeoReport(i: AeoInput): { score: number; markdown: string } {
  const p = analyzePage(i.html); const groups = parseRobots(i.robotsTxt ?? ""); const path = new URL(i.url).pathname || "/";
  const bots = AI_BOTS.map(b => ({ ...b, allowed: robotsAllows(groups, b.ua, path) }));
  const checks: { name: string; pts: number; max: number; fix?: string }[] = [];
  const add = (name: string, max: number, ok: boolean | number, fix: string) => { const pts = typeof ok === "number" ? Math.round(ok * max) : ok ? max : 0; checks.push({ name, pts, max, fix: pts < max ? fix : undefined }); };
  add("Page returns 200", 10, i.status === 200, `Page returned HTTP ${i.status}. AI crawlers skip non-200 pages.`);
  add("Indexable and snippet-able (no noindex / nosnippet / max-snippet:0)", 10, !/noindex|nosnippet|max-snippet:\s*0/.test(p.robotsMeta), `Remove "${p.robotsMeta}" from meta robots; it blocks AI answers from quoting this page.`);
  const answer = bots.filter(b => b.role === "answer"); const okAnswer = answer.filter(b => b.allowed).length / answer.length;
  add("Answer-engine crawlers allowed in robots.txt", 20, okAnswer, `Allow ${answer.filter(b => !b.allowed).map(b => b.ua).join(", ")} in robots.txt so ChatGPT search, Claude, Perplexity, Copilot and AI Overviews can cite you.`);
  add("Structured data (JSON-LD)", 10, p.schemaTypes.length ? (p.schemaTypes.some(t => /FAQPage|Article|BlogPosting|HowTo|Product|Organization|LocalBusiness|Service/.test(t)) ? 1 : 0.5) : false, "Add JSON-LD (Organization + Article/FAQPage/Product as relevant) so engines can extract entities and answers.");
  add("Title and meta description", 5, (p.title ? 0.5 : 0) + (p.metaDesc ? 0.5 : 0), "Add a descriptive <title> and meta description that state the answer/offer plainly.");
  add("Exactly one H1", 5, p.h1 === 1, `Found ${p.h1} H1 tags; use exactly one that names the topic.`);
  add("Scannable sections (3+ H2/H3)", 5, Math.min(p.headings / 3, 1), "Break content into H2/H3 sections; answer engines lift self-contained sections.");
  add("Question-style headings", 5, Math.min(p.questionHeadings / 2, 1), "Phrase 2+ headings as the questions buyers ask (\"How much does X cost?\") and answer in the first sentence below.");
  add("Server-rendered text (300+ words in HTML)", 10, Math.min(p.words / 300, 1), `Only ${p.words} words are in the raw HTML. Many AI crawlers do not run JavaScript; server-render the main content.`);
  add("Lists or tables", 5, p.lists + p.tables > 0, "Add a bulleted list, steps or comparison table; they are quoted far more often.");
  add("Freshness and authorship signals", 5, (p.dated ? 0.5 : 0) + (p.author ? 0.5 : 0), "Show a visible updated date and author (plus datePublished/dateModified/author in schema).");
  add("Canonical URL", 5, p.canonical, "Add <link rel=\"canonical\"> to consolidate signals on one URL.");
  add("llms.txt published", 5, i.llmsTxtFound, "Publish /llms.txt (run check_llms_txt for the format).");
  const score = checks.reduce((a, c) => a + c.pts, 0);
  const md = [`# AI-search visibility (AEO) check: ${i.url}`, "", `**Score: ${score}/100**`, "",
    "| Check | Points |", "|---|---|", ...checks.map(c => `| ${c.name} | ${c.pts}/${c.max} |`), "",
    "## AI crawler access (robots.txt)", "", "| Bot | Owner | Role | Allowed |", "|---|---|---|---|",
    ...bots.map(b => `| ${b.ua} | ${b.owner} | ${b.role} | ${b.allowed ? "yes" : "**NO**"} |`), "",
    i.robotsTxt === null ? "_No robots.txt found (everything allowed by default)._\n" : "",
    "## Page signals", "", `- Words in HTML: ${p.words}; H1: ${p.h1}; H2/H3: ${p.headings} (${p.questionHeadings} question-style); lists: ${p.lists}; tables: ${p.tables}`,
    `- Schema types: ${p.schemaTypes.join(", ") || "none"}`, `- Meta robots: ${p.robotsMeta || "(none)"}; canonical: ${p.canonical ? "yes" : "no"}; dated: ${p.dated ? "yes" : "no"}; author: ${p.author ? "yes" : "no"}`, "",
    "## Fixes, highest impact first", "", ...checks.filter(c => c.fix).sort((a, b) => (b.max - b.pts) - (a.max - a.pts)).map((c, n) => `${n + 1}. ${c.fix}`),
    checks.every(c => !c.fix) ? "No fixes needed." : "", "", "Training-only bots (GPTBot, ClaudeBot, Google-Extended, CCBot) can be blocked without hurting AI-search citations; answer and user bots should stay allowed."];
  return { score, markdown: md.filter(l => l !== undefined).join("\n") };
}

// ---------- llms.txt (llmstxt.org format) ----------
export function analyzeLlmsTxt(txt: string) {
  const lines = txt.split(/\r?\n/); const issues: string[] = []; const ok: string[] = [];
  const first = lines.find(l => l.trim()) ?? "";
  if (/^#\s+\S/.test(first)) ok.push(`H1 title: "${first.replace(/^#\s+/, "")}"`); else issues.push("First line must be an H1 with the site/project name (`# Name`).");
  if (lines.filter(l => /^#\s+/.test(l)).length > 1) issues.push("Only one H1 is allowed; use `##` for sections.");
  const bq = lines.findIndex(l => /^>\s+\S/.test(l));
  const firstH2 = lines.findIndex(l => /^##\s+/.test(l));
  if (bq >= 0 && (firstH2 < 0 || bq < firstH2)) ok.push("Blockquote summary present."); else issues.push("Add a one-paragraph `> summary` right after the H1 describing what the site offers.");
  const sections = lines.filter(l => /^##\s+/.test(l)).map(l => l.replace(/^##\s+/, "").trim());
  if (sections.length) ok.push(`${sections.length} section(s): ${sections.join(", ")}`); else issues.push("Add `##` sections (e.g. Docs, Products, Pricing) with link lists.");
  const linkLines = lines.filter(l => /^\s*[-*]\s+\[[^\]]+\]\([^)]+\)/.test(l));
  const badLinks = lines.filter(l => /^\s*[-*]\s+/.test(l) && !/^\s*[-*]\s+\[[^\]]+\]\([^)]+\)/.test(l));
  const relLinks = linkLines.filter(l => !/\]\(https?:\/\//.test(l));
  const described = linkLines.filter(l => /\)\s*:\s*\S/.test(l)).length;
  if (linkLines.length) ok.push(`${linkLines.length} link(s), ${described} with descriptions.`); else issues.push("No `- [Title](https://url): description` links found.");
  if (badLinks.length) issues.push(`${badLinks.length} list item(s) are not in \`- [Title](url): notes\` form, e.g. "${badLinks[0].trim().slice(0, 80)}".`);
  if (relLinks.length) issues.push(`${relLinks.length} link(s) are relative; use absolute https URLs.`);
  if (linkLines.length && described < linkLines.length / 2) issues.push("Most links lack a `: description`; add one-line notes so models know when to fetch each.");
  if (!sections.some(s => /^optional$/i.test(s)) && linkLines.length > 15) issues.push("Consider an `## Optional` section for secondary links so context-limited agents can skip them.");
  if (txt.length > 50_000) issues.push(`File is ${Math.round(txt.length / 1000)} KB; keep llms.txt concise and move full content to /llms-full.txt.`);
  return { ok, issues, links: linkLines.length, sections, bytes: txt.length };
}
export function llmsReport(origin: string, llms: { status: number; text: string } | null, full: { status: number; text: string } | null) {
  const out = [`# llms.txt check: ${origin}`, ""];
  if (!llms || llms.status !== 200 || /<html/i.test(llms.text.slice(0, 500))) {
    out.push(`**Not found** at ${origin}/llms.txt (HTTP ${llms?.status ?? "error"}).`, "", "## Starter llms.txt", "", "```markdown", "# Your Brand", "", "> One-paragraph summary: what you offer, who it is for, where you operate.", "",
      "## Key pages", "", `- [Pricing](${origin}/pricing): plans and what each includes`, `- [Services](${origin}/services): what we do`, "", "## Optional", "", `- [Blog](${origin}/blog): guides and updates`, "```");
  } else {
    const a = analyzeLlmsTxt(llms.text); const score = Math.max(0, 100 - a.issues.length * 15);
    out.push(`**Found** (${a.bytes} bytes). Format score: **${score}/100**`, "", "## Passing", ...a.ok.map(x => `- ${x}`), "", "## Issues", ...(a.issues.length ? a.issues.map(x => `- ${x}`) : ["- None"]));
  }
  out.push("", `llms-full.txt: ${full && full.status === 200 && !/<html/i.test(full.text.slice(0, 500)) ? `found (${full.text.length} bytes)` : "not found (optional; full Markdown content for agents)"}`);
  return out.join("\n");
}

// ---------- safe fetch ----------
const PRIVATE = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;
export function assertPublicUrl(raw: string): URL {
  let u: URL; try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error(`Not a valid URL: ${raw}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs are supported.");
  if (PRIVATE.test(u.hostname) || /^\d+$/.test(u.hostname)) throw new Error("Private or local addresses are not allowed.");
  return u;
}
export async function safeFetchText(fetchImpl: typeof fetch, url: string, maxBytes = 2_000_000, timeoutMs = 10_000): Promise<{ status: number; text: string; contentType: string }> {
  const u = assertPublicUrl(url); const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(u.toString(), { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "CygnixSEO-MCP/1.0 (+https://mcp.cygnixlabs.com)", Accept: "text/html,text/plain,*/*" } });
    if (r.url) assertPublicUrl(r.url);
    const buf = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, text: new TextDecoder().decode(buf.slice(0, maxBytes)), contentType: r.headers.get("content-type") || "" };
  } finally { clearTimeout(t); }
}
export async function runAeoCheck(fetchImpl: typeof fetch, url: string) {
  const u = assertPublicUrl(url);
  const [page, robots, llms] = await Promise.all([
    safeFetchText(fetchImpl, u.toString()), safeFetchText(fetchImpl, `${u.origin}/robots.txt`).catch(() => null), safeFetchText(fetchImpl, `${u.origin}/llms.txt`).catch(() => null)]);
  return aeoReport({ url: u.toString(), status: page.status, html: page.text, robotsTxt: robots && robots.status === 200 ? robots.text : null,
    llmsTxtFound: !!llms && llms.status === 200 && !/<html/i.test(llms.text.slice(0, 500)) });
}
export async function runLlmsCheck(fetchImpl: typeof fetch, url: string) {
  const u = assertPublicUrl(url);
  const [l, f] = await Promise.all([safeFetchText(fetchImpl, `${u.origin}/llms.txt`).catch(() => null), safeFetchText(fetchImpl, `${u.origin}/llms-full.txt`).catch(() => null)]);
  return llmsReport(u.origin, l, f);
}
