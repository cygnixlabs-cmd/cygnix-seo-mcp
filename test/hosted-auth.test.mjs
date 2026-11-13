import test from "node:test"; import assert from "node:assert/strict";
import { makeApp } from "./helpers.mjs";

test("unauthenticated /mcp returns 401 with OAuth resource metadata hint", async () => {
  const { rpc } = makeApp();
  const r = await rpc(null, "tools/list");
  assert.equal(r.status, 401);
  assert.match(r.res.headers.get("www-authenticate"), /resource_metadata="https:\/\/mcp\.test\/\.well-known\/oauth-protected-resource"/);
});

test("signup issues a free key that authenticates; key stored only as a hash", async () => {
  const { signup, rpc, db } = makeApp();
  const s = await signup("Owner@Example.com");
  assert.match(s.api_key, /^cyg_live_[A-Za-z0-9]{32}$/); assert.equal(s.tier, "free");
  const r = await rpc(s.api_key, "tools/list");
  assert.equal(r.status, 200); assert.ok(r.body.result.tools.length >= 10);
  const rows = (await db.prepare("SELECT key_hash, key_prefix FROM api_keys").all()).results;
  assert.equal(rows.length, 1); assert.notEqual(rows[0].key_hash, s.api_key); assert.equal(rows[0].key_hash.length, 64);
  assert.ok(!JSON.stringify(rows).includes(s.api_key));
});

test("X-Api-Key header also works; bad and revoked keys are rejected", async () => {
  const { signup, rpc, req } = makeApp();
  const s = await signup();
  assert.equal((await rpc(null, "tools/list", {}, { "x-api-key": s.api_key })).status, 200);
  assert.equal((await rpc("cyg_live_" + "x".repeat(32), "tools/list")).status, 401);
  const keys = await (await req("/v1/keys", { headers: { authorization: `Bearer ${s.api_key}` } })).json();
  const del = await req(`/v1/keys/${keys.keys[0].id}`, { method: "DELETE", headers: { authorization: `Bearer ${s.api_key}` } });
  assert.equal(del.status, 200);
  assert.equal((await rpc(s.api_key, "tools/list")).status, 401);
});

test("signup validation: terms required, email unique, per-IP limit", async () => {
  const { post } = makeApp({ SIGNUP_PER_IP_PER_HOUR: "4" });
  assert.equal((await post("/v1/signup", { email: "a@b.co" })).status, 400);
  assert.equal((await post("/v1/signup", { email: "nope", accept_terms: true })).status, 400);
  assert.equal((await post("/v1/signup", { email: "a@b.co", accept_terms: true })).status, 201);
  assert.equal((await post("/v1/signup", { email: "A@B.co", accept_terms: true })).status, 409);
  assert.equal((await post("/v1/signup", { email: "c@b.co", accept_terms: true })).status, 429);
});

test("suspended accounts get 403", async () => {
  const { signup, rpc, store } = makeApp();
  const s = await signup(); await store.setStatus(s.account_id, "suspended");
  assert.equal((await rpc(s.api_key, "tools/list")).status, 403);
});

test("OAuth bridge: DCR -> authorize with API key -> PKCE token -> MCP call -> refresh rotation", async () => {
  const { signup, post, req, rpc, call } = makeApp();
  const s = await signup();
  const meta = await (await req("/.well-known/oauth-authorization-server")).json();
  assert.equal(meta.token_endpoint, "https://mcp.test/oauth/token"); assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  const prm = await (await req("/.well-known/oauth-protected-resource")).json();
  assert.equal(prm.resource, "https://mcp.test/mcp");
  assert.equal((await post("/oauth/register", { redirect_uris: ["javascript:alert(1)"] })).status, 400);
  const reg = await (await post("/oauth/register", { client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] })).json();
  const verifier = "v".repeat(64);
  const { createHash } = await import("node:crypto");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: "https://mcp.test/mcp" });
  const page = await req(`/oauth/authorize?${q}`); assert.equal(page.status, 200); assert.match(await page.text(), /Paste your API key/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  const bad = await req("/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(q), api_key: "cyg_live_nope" }) });
  assert.equal(bad.status, 400);
  const ok = await req("/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(q), api_key: s.api_key }) });
  assert.equal(ok.status, 302);
  const loc = new URL(ok.headers.get("location")); assert.equal(loc.searchParams.get("state"), "xyz");
  const code = loc.searchParams.get("code");
  const wrongPkce = await post("/oauth/token", new URLSearchParams({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], code_verifier: "w".repeat(64) }).toString(), { "content-type": "application/x-www-form-urlencoded" });
  assert.equal(wrongPkce.status, 400);
  // code is single-use: the failed attempt consumed it, so start again
  const ok2 = await req("/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(q), api_key: s.api_key }) });
  const code2 = new URL(ok2.headers.get("location")).searchParams.get("code");
  const tok = await (await post("/oauth/token", new URLSearchParams({ grant_type: "authorization_code", code: code2, client_id: reg.client_id, redirect_uri: reg.redirect_uris[0], code_verifier: verifier }).toString(), { "content-type": "application/x-www-form-urlencoded" })).json();
  assert.match(tok.access_token, /^cyg_at_/); assert.match(tok.refresh_token, /^cyg_rt_/);
  const r = await call(tok.access_token, "classify_search_intent", { keywords: "buy seo audit" });
  assert.equal(r.status, 200); assert.match(r.body.result.content[0].text, /transactional/);
  const ref = await (await post("/oauth/token", { grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id })).json();
  assert.match(ref.access_token, /^cyg_at_/);
  assert.equal((await post("/oauth/token", { grant_type: "refresh_token", refresh_token: tok.refresh_token })).status, 400, "old refresh token is rotated out");
});
