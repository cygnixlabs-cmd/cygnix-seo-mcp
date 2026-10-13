// Deterministic SEO helpers. No network calls, no API keys, no search-volume claims.
export const LINKS = {
  vol1: "https://www.agensi.io/bundles/seo-toolkit-keyword-research-to-content-refresh",
  vol2: "https://www.agensi.io/bundles/seo-toolkit-vol-2-audit-fix-pack",
  bundle: "https://cygnixlabs.gumroad.com/l/seo-operator-bundle",
};
export const footer = (link: string) => `\n---\nFull workflow: Cygnix SEO Toolkit on Agensi: ${link}`;

const STOP = new Set("a an the and or for of to in on with by at from is are vs best top how what why when where which who do does can i my your near me 2024 2025 2026".split(" "));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(ing|ers|er|es|s)$/, "").slice(0, 12) || w;
const tokens = (s: string) => norm(s).split(" ").filter(w => w && !STOP.has(w)).map(stem);
export const splitList = (t: string) => [...new Set(t.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean))];

// ---------- 1. Search intent ----------
const INTENT: Record<string, RegExp> = {
  transactional: /\b(buy|price|pricing|cheap|discount|coupon|deal|order|hire|subscribe|download|free trial|for sale|quote|cost)\b/,
  commercial: /\b(best|top|vs|versus|review|reviews|compare|comparison|alternative|alternatives|alternatives to|tool|tools|software|service|services|agency|recommended)\b/,
  navigational: /\b(login|log in|sign in|signup|sign up|account|official|website|app|dashboard|contact|support)\b/,
  informational: /\b(how|what|why|when|where|who|guide|tutorial|tips|ideas|examples|learn|meaning|definition|checklist|template|steps|ways)\b/,
};
export function classifyIntent(kw: string): { intent: string; signals: string[] } {
  const k = norm(kw); const hits: string[] = []; let intent = "";
  for (const [name, re] of Object.entries(INTENT)) { const m = k.match(re); if (m) { hits.push(`${name}:"${m[0]}"`); if (!intent) intent = name; } }
  if (!intent) intent = k.split(" ").length <= 2 ? "navigational/ambiguous (short head term; check the SERP)" : "informational (default)";
  return { intent, signals: hits };
}
export function intentTool(text: string): string {
  const kws = splitList(text);
  const rows = kws.map(k => { const r = classifyIntent(k); return `| ${k} | ${r.intent} | ${r.signals.join(", ") || "-"} |`; });
  const counts: Record<string, number> = {};
  kws.forEach(k => { const i = classifyIntent(k).intent.split(" ")[0]; counts[i] = (counts[i] || 0) + 1; });
  return `# Search intent (rule-based, ${kws.length} keywords)\n\n| Keyword | Intent | Signals |\n|---|---|---|\n${rows.join("\n")}\n\nTotals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}\nNote: modifiers-based heuristic. Confirm mixed-intent terms by checking the live SERP.` + footer(LINKS.vol1);
}

// ---------- 2. Keyword clustering ----------
export function cluster(kws: string[], minShared = 1) {
  const toks = kws.map(k => new Set(tokens(k)));
  const parent = kws.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < kws.length; i++) for (let j = i + 1; j < kws.length; j++) {
    const a = toks[i], b = toks[j]; const shared = [...a].filter(t => b.has(t)).length;
    const jacc = shared / (new Set([...a, ...b]).size || 1);
    if (shared >= Math.max(minShared, Math.min(a.size, b.size) > 2 ? 2 : 1) && jacc >= 0.34) parent[find(i)] = find(j);
  }
  const groups = new Map<number, string[]>();
  kws.forEach((k, i) => { const r = find(i); groups.set(r, [...(groups.get(r) || []), k]); });
  return [...groups.values()].map(g => {
    const freq: Record<string, number> = {}; g.forEach(k => new Set(tokens(k)).forEach(t => (freq[t] = (freq[t] || 0) + 1)));
    const label = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(e => e[0]).join(" ");
    const pillar = [...g].sort((a, b) => a.split(" ").length - b.split(" ").length || a.length - b.length)[0];
    return { label: label || pillar, pillar, keywords: g };
  }).sort((a, b) => b.keywords.length - a.keywords.length);
}
export function clusterTool(text: string, minShared = 1): string {
  const kws = splitList(text); const cs = cluster(kws, minShared);
  const body = cs.map((c, i) => `## ${i + 1}. ${c.label} (${c.keywords.length})\nSuggested pillar/primary: **${c.pillar}**\n${c.keywords.map(k => `- ${k} _(${classifyIntent(k).intent.split(" ")[0]})_`).join("\n")}`).join("\n\n");
  return `# Keyword clusters: ${kws.length} keywords → ${cs.length} clusters\nLexical overlap clustering (stopwords removed, light stemming). One cluster ≈ one page; singletons may be long-tail sections.\n\n${body}` + footer(LINKS.vol1);
}

// ---------- 3. Cannibalization from GSC CSV ----------
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ""; }
    else cell += c; }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row); return rows;
}
const num = (s = "") => parseFloat(s.replace(/[%,\s]/g, "")) || 0;
export function cannibalization(csv: string, minImpr = 10) {
  const rows = parseCSV(csv.trim()); if (rows.length < 2) throw new Error("Need a header row plus data rows (query,page,clicks,impressions,ctr,position).");
  const h = rows[0].map(x => x.toLowerCase().trim());
  const col = (...n: string[]) => h.findIndex(x => n.some(y => x.includes(y)));
  const qi = col("quer", "keyword"), pi = col("page", "url", "landing"), ci = col("click"), ii = col("impr"), po = col("position", "pos");
  if (qi < 0 || pi < 0) throw new Error(`Could not find query and page columns in header: ${rows[0].join(", ")}`);
  const by = new Map<string, { page: string; clicks: number; impr: number; pos: number }[]>();
  for (const r of rows.slice(1)) { const q = (r[qi] || "").trim().toLowerCase(); if (!q) continue;
    const e = { page: (r[pi] || "").trim(), clicks: num(r[ci]), impr: num(r[ii]), pos: num(r[po]) };
    by.set(q, [...(by.get(q) || []), e]); }
  const issues = [];
  for (const [q, list] of by) {
    const pages = new Map<string, { page: string; clicks: number; impr: number; pos: number }>();
    list.forEach(e => { const p = pages.get(e.page); if (p) { p.pos = (p.pos * p.impr + e.pos * e.impr) / ((p.impr + e.impr) || 1); p.clicks += e.clicks; p.impr += e.impr; } else pages.set(e.page, { ...e }); });
    const ps = [...pages.values()].filter(p => p.impr >= minImpr).sort((a, b) => b.clicks - a.clicks || b.impr - a.impr);
    if (ps.length < 2) continue;
    const tot = ps.reduce((s, p) => s + p.impr, 0); const share2 = ps[1].impr / tot;
    const severity = share2 >= 0.3 ? "HIGH" : share2 >= 0.15 ? "MEDIUM" : "LOW";
    issues.push({ query: q, severity, share2, pages: ps, action: severity === "LOW" ? "Monitor; likely fine (dominant page is clear)." : `Pick ${ps[0].page} as canonical target; merge/301 or de-optimize the others and point internal links with "${q}" anchors to it.` });
  }
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as Record<string, number>;
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || b.pages.reduce((s, p) => s + p.impr, 0) - a.pages.reduce((s, p) => s + p.impr, 0));
}
export function cannibalTool(csv: string, minImpr = 10): string {
  const is = cannibalization(csv, minImpr);
  if (!is.length) return `# No cannibalization found\nNo query had 2+ pages with ≥${minImpr} impressions. Export GSC Performance with both Query and Page dimensions.` + footer(LINKS.vol2);
  const body = is.map(i => `## [${i.severity}] "${i.query}" (${i.pages.length} pages, #2 page share ${(i.share2 * 100).toFixed(0)}%)\n| Page | Clicks | Impr | Avg pos |\n|---|---|---|---|\n${i.pages.map(p => `| ${p.page} | ${p.clicks} | ${p.impr} | ${p.pos.toFixed(1)} |`).join("\n")}\n**Action:** ${i.action}`).join("\n\n");
  return `# Keyword cannibalization: ${is.length} queries with competing pages\n\n${body}` + footer(LINKS.vol2);
}

// ---------- 4. Title / meta checker ----------
const POWER = /\b(\d+|guide|checklist|template|free|step|how|best|new|easy|fast|proven|examples?|\d{4})\b/i;
// Approximate SERP pixel widths (Arial ~ title 20px / desc 14px).
const W: Record<string, number> = { i: .28, l: .28, j: .28, t: .33, f: .33, r: .39, " ": .28, m: .89, w: .78, W: .94, M: .83 };
export const pixels = (s: string, size: number) => Math.round([...s].reduce((a, c) => a + (W[c] ?? (/[A-Z]/.test(c) ? .67 : .55)), 0) * size);
export function checkTitleMeta(title: string, meta = "", keyword = "") {
  const out: string[] = []; let score = 100; const tpx = pixels(title, 20), mpx = pixels(meta, 14);
  const pen = (n: number, m: string) => { score -= n; out.push(`✗ ${m}`); }; const ok = (m: string) => out.push(`✓ ${m}`);
  if (title.length < 30) pen(15, `Title short (${title.length} chars). Aim 45–60.`); else if (tpx > 580 || title.length > 60) pen(15, `Title likely truncated (${title.length} chars, ~${tpx}px > ~580px).`); else ok(`Title length ${title.length} chars (~${tpx}px).`);
  if (meta) { if (meta.length < 70) pen(10, `Meta short (${meta.length}). Aim 120–155.`); else if (meta.length > 160 || mpx > 920) pen(10, `Meta likely truncated (${meta.length} chars, ~${mpx}px).`); else ok(`Meta length ${meta.length} chars.`); } else pen(15, "No meta description; Google will pick a snippet.");
  if (keyword) { const k = norm(keyword), t = norm(title);
    if (!t.includes(k)) { const kt = tokens(keyword), tt = new Set(tokens(title)); const cov = kt.filter(x => tt.has(x)).length / (kt.length || 1); cov >= .6 ? pen(5, `Keyword partially in title (${Math.round(cov * 100)}%).`) : pen(20, `Keyword "${keyword}" missing from title.`); }
    else if (t.indexOf(k) > t.length / 2) pen(5, "Keyword appears late in title; front-load it."); else ok("Keyword front-loaded in title.");
    if (meta && !norm(meta).includes(k)) pen(5, "Keyword not in meta (Google bolds matches)."); }
  if (!POWER.test(title)) pen(5, "No CTR hook (number, year, 'guide', 'checklist', 'free'...)."); else ok("Has a CTR hook.");
  if (title === title.toUpperCase() && /[A-Z]/.test(title)) pen(10, "ALL CAPS title.");
  if (meta && !/[.!?]$/.test(meta.trim())) pen(3, "Meta has no closing punctuation / CTA.");
  return { score: Math.max(0, score), notes: out };
}
export function titleMetaTool(items: { title: string; meta?: string; keyword?: string; url?: string }[]): string {
  const body = items.map((it, i) => { const r = checkTitleMeta(it.title, it.meta, it.keyword);
    return `## ${i + 1}. ${it.url || it.title}: score ${r.score}/100\n${r.notes.map(n => `- ${n}`).join("\n")}`; }).join("\n\n");
  return `# Title & meta check (${items.length})\nScores are heuristic CTR-readiness, not ranking predictions. Pixel widths approximate.\n\n${body}` + footer(LINKS.vol2);
}

// ---------- 5. Content brief ----------
export function briefTool(keyword: string, related = "", audience = "", wordCount = 1500): string {
  const it = classifyIntent(keyword).intent.split(" ")[0]; const rel = splitList(related);
  const cs = cluster(rel); const K = keyword.trim(); const Kc = K.charAt(0).toUpperCase() + K.slice(1);
  const y = new Date().getFullYear();
  const base: Record<string, string[]> = {
    informational: [`What is ${K}?`, `Why ${K} matters`, `How to ${K.replace(/^how to /i, "")}: step by step`, "Common mistakes to avoid", "Examples", "Checklist / template", "FAQ"],
    commercial: [`What to look for in ${K}`, "Comparison table", "Top options reviewed (pros/cons/pricing tier)", "Who each option is best for", "How we evaluated", "FAQ", "Verdict"],
    transactional: [`${Kc}: what you get`, "Pricing / packages", "How it works", "Proof: results, reviews, guarantees", "FAQ / objections", "Call to action"],
    navigational: [`${Kc} overview`, "Key features / where to find them", "Getting started", "Troubleshooting", "FAQ"],
  };
  const h2 = [...(base[it] || base.informational)];
  cs.filter(c => c.keywords.length).slice(0, 5).forEach(c => { if (!h2.some(h => norm(h).includes(norm(c.pillar)))) h2.splice(Math.max(1, h2.length - 1), 0, `${c.pillar.charAt(0).toUpperCase() + c.pillar.slice(1)} (covers: ${c.keywords.join(", ")})`); });
  const per = Math.round(wordCount / (h2.length + 1) / 50) * 50;
  const q = rel.filter(r => /^(how|what|why|when|where|who|can|does|is|are|should)\b/i.test(r));
  return `# Content brief: ${K}
- Search intent (rule-based): **${it}**${audience ? `\n- Audience: ${audience}` : ""}
- Target length: ~${wordCount} words (~${per} per section). Validate against top-ranking pages.
- Title options:\n  1. ${Kc}: The Complete Guide (${y})\n  2. ${Kc}: ${h2.length - 1} Steps, Examples & Checklist\n  3. ${it === "commercial" ? `Best ${K.replace(/^best /i, "")}: Compared & Reviewed` : `How to Master ${Kc} (Without Guesswork)`}
- Meta draft: Learn ${K} with a clear, step-by-step approach: examples, mistakes to avoid and a free checklist. Updated ${y}.
- Slug: /${norm(K).replace(/\s+/g, "-")}

## Outline
H1: ${Kc}
${h2.map(h => `- H2: ${h}`).join("\n")}

## Must answer (from your related list)
${q.length ? q.map(x => `- ${x}`).join("\n") : "- (add People Also Ask questions from the SERP)"}

## On-page checklist
- Primary keyword in H1, first 100 words, URL, and title
- Related terms used naturally across H2s: ${rel.slice(0, 12).join(", ") || "n/a"}
- 3–5 internal links to/from related pages; 1–2 authoritative external citations
- Add FAQ schema if FAQ section included; original image/diagram with descriptive alt text` + footer(LINKS.bundle);
}
