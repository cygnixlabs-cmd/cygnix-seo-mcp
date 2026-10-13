import test from "node:test"; import assert from "node:assert/strict";
import * as T from "../dist/tools.js";
const FOOT = "Full workflow: Cygnix SEO Toolkit on Agensi";
test("intent", () => {
  assert.equal(T.classifyIntent("buy seo audit template").intent, "transactional");
  assert.equal(T.classifyIntent("best keyword research tools").intent, "commercial");
  assert.equal(T.classifyIntent("how to do keyword research").intent, "informational");
  assert.equal(T.classifyIntent("ahrefs login").intent, "navigational");
  const o = T.intentTool("how to do keyword research\nbest seo tools"); assert.ok(o.includes(FOOT) && o.includes(T.LINKS.vol1));
});
test("cluster", () => {
  const cs = T.cluster(["keyword research tool","keyword research tools free","free keyword research","content brief template","seo content brief","technical seo audit"]);
  const kr = cs.find(c => c.keywords.includes("keyword research tool")); assert.ok(kr.keywords.length >= 3);
  assert.ok(cs.find(c => c.keywords.includes("seo content brief")).keywords.includes("content brief template"));
  assert.ok(T.clusterTool("a b\nc d").includes(FOOT));
});
test("cannibalization", () => {
  const csv = `Query,Page,Clicks,Impressions,CTR,Position
seo audit checklist,https://x.com/a,30,1000,3%,4.2
seo audit checklist,https://x.com/b,5,600,0.8%,9.1
"keyword, research",https://x.com/c,10,200,5%,3
solo query,https://x.com/d,1,50,2%,12`;
  const is = T.cannibalization(csv); assert.equal(is.length, 1); assert.equal(is[0].severity, "HIGH"); assert.equal(is[0].pages[0].page, "https://x.com/a");
  const o = T.cannibalTool(csv); assert.ok(o.includes(T.LINKS.vol2) && o.includes(FOOT));
  assert.throws(() => T.cannibalization("foo,bar\n1,2"));
});
test("title/meta", () => {
  const good = T.checkTitleMeta("Keyword Research Guide: 7 Steps for Beginners (2026)", "Learn keyword research step by step with free templates, real examples and a checklist you can use today to find topics that rank.", "keyword research");
  const bad = T.checkTitleMeta("Home", "", "keyword research");
  assert.ok(good.score > 85, String(good.score)); assert.ok(bad.score < 50);
  assert.ok(T.titleMetaTool([{ title: "Home" }]).includes(T.LINKS.vol2));
});
test("brief", () => {
  const o = T.briefTool("keyword research", "how to do keyword research\nkeyword research tools\nfree keyword research", "", 1800);
  assert.ok(o.includes("## Outline") && o.includes("how to do keyword research") && o.includes(T.LINKS.bundle) && !/search volume:\s*\d/i.test(o));
});
