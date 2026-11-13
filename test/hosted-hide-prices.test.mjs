import test from "node:test"; import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { makeApp } from "./helpers.mjs";
import { matchesHidden, hidePatterns } from "../dist/hosted/client-detect.js";

const PRICE = /\$\d|\/mo\b|upgrade|pricing|Agensi/i;
const text = r => r.body.result?.content?.[0]?.text ?? r.body.error?.message;
const CHATGPT_UA = { "user-agent": "openai-mcp/1.0.0 (ChatGPT)" };

test("pattern config: default chatgpt,openai; empty string disables; case-insensitive substrings", () => {
  assert.deepEqual(hidePatterns({}), ["chatgpt", "openai"]);
  assert.deepEqual(hidePatterns({ HIDE_PRICES_FOR_CLIENTS: "" }), []);
  assert.equal(matchesHidden({}, ["openai-mcp/1.0.0"]), true); assert.equal(matchesHidden({}, ["claude-ai"]), false);
  assert.equal(matchesHidden({ HIDE_PRICES_FOR_CLIENTS: "Claude" }, ["claude-ai"]), true);
});

test("ChatGPT (User-Agent): account_status, Agency-only tools and core tool footers show no prices or upgrade CTAs", async () => {
  const { signup, rpc } = makeApp();
  const s = await signup();
  const call = (name, args = {}, h = CHATGPT_UA) => rpc(s.api_key, "tools/call", { name, arguments: args }, h);
  const st = text(await call("account_status"));
  assert.doesNotMatch(st, PRICE); assert.match(st, /Plan: Free/); assert.match(st, /https:\/\/mcp\.test\/account\.html/);
  const ag = await call("create_white_label_report", { title: "x", content_markdown: "y" });
  assert.equal(ag.body.result.isError, true); assert.doesNotMatch(text(ag), PRICE); assert.match(text(ag), /not included in this key's current plan/);
  const cl = text(await call("cluster_keywords", { keywords: "seo audit, seo audit checklist" }));
  assert.doesNotMatch(cl, /Agensi|Full workflow/);
  const list = await rpc(s.api_key, "tools/list", {}, CHATGPT_UA);
  for (const t of list.body.result.tools) assert.doesNotMatch(t.description, /\$\d|upgrade/i, t.name);
  // Claude / generic clients still see prices and the upsell footer
  assert.match(text(await call("account_status", {}, { "user-agent": "Claude-User" })), /\$0\/mo/);
  assert.match(text(await call("cluster_keywords", { keywords: "a b, a c" }, {})), /Agensi/);
});

test("ChatGPT quota + rate-limit errors: no prices, account_url instead of upgrade_url", async () => {
  const { signup, rpc, db } = makeApp();
  const s = await signup();
  const period = new Date().toISOString().slice(0, 7);
  const k = (await db.prepare("SELECT id FROM api_keys WHERE account_id=?").bind(s.account_id).first()).id;
  await db.prepare("INSERT INTO usage_monthly (key_id,account_id,period,calls) VALUES (?,?,?,300)").bind(k, s.account_id, period).run();
  const q = await rpc(s.api_key, "tools/call", { name: "account_status", arguments: {} }, CHATGPT_UA);
  assert.match(q.body.error.message, /Monthly quota reached/); assert.doesNotMatch(q.body.error.message, PRICE);
  assert.equal(q.body.error.data.upgrade_url, undefined); assert.equal(q.body.error.data.account_url, "https://mcp.test/account.html");
  const q2 = await rpc(s.api_key, "tools/call", { name: "account_status", arguments: {} });
  assert.match(q2.body.error.message, /Upgrade to Pro \(\$15\/mo/, "non-ChatGPT unchanged");
  let last; for (let i = 0; i < 12; i++) last = await rpc(s.api_key, "ping", {}, CHATGPT_UA);
  assert.equal(last.status, 429); assert.doesNotMatch(last.body.error.message, PRICE); assert.equal(last.body.error.data.upgrade_url, undefined);
});

test("detected via initialize clientInfo (remembered for later calls on the key) and via OAuth client_name", async () => {
  const { signup, rpc, post, req } = makeApp();
  const s = await signup();
  await rpc(s.api_key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openai-mcp", version: "1.0.0" } });
  assert.doesNotMatch(text(await rpc(s.api_key, "tools/call", { name: "account_status", arguments: {} })), PRICE, "stored clientInfo hint");
  const flag = makeApp({ HIDE_PRICES_FOR_CLIENTS: "" }); const s2 = await flag.signup();
  assert.match(text(await flag.rpc(s2.api_key, "tools/call", { name: "account_status", arguments: {} }, CHATGPT_UA)), /\$0\/mo/, "flag off");
  // OAuth: client registered as "ChatGPT"
  const s3 = await signup();
  const reg = await (await post("/oauth/register", { client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] })).json();
  const verifier = randomBytes(32).toString("base64url"); const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({ client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s" });
  const authPage = await (await req(`/oauth/authorize?${q}`)).text(); assert.doesNotMatch(authPage, /300 calls/);
  const ap = await req("/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(q), api_key: s3.api_key }).toString() });
  const code = new URL(ap.headers.get("location")).searchParams.get("code");
  const tok = await (await post("/oauth/token", { grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], code_verifier: verifier })).json();
  assert.doesNotMatch(text(await rpc(tok.access_token, "tools/call", { name: "account_status", arguments: {} })), PRICE);
});
