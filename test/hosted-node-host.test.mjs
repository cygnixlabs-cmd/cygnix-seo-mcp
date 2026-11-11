// cPanel / Passenger / LiteSpeed host path: app.cjs startup file, PORT as a socket path, node:sqlite file DB,
// stateless JSON Streamable HTTP, and the SQLite -> MySQL translation used by HOSTED_DB_DRIVER=mysql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { translateSql } from "../dist/hosted/mysql-db.js";
import { listenTarget } from "../dist/hosted/node-server.js";

const root = new URL("..", import.meta.url).pathname;

function call(socketPath, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const r = request({ socketPath, method, path, headers: { host: "mcp.cygnixlabs.com", ...(data ? { "content-type": "application/json", "content-length": data.length } : {}), ...headers } }, res => {
      const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}

test("translateSql maps SQLite upserts and helpers to MySQL", () => {
  assert.equal(translateSql("INSERT OR IGNORE INTO billing_events (id) VALUES (?)"), "INSERT IGNORE INTO billing_events (id) VALUES (?)");
  assert.equal(translateSql("INSERT INTO usage_monthly (key_id,period,calls) VALUES (?,?,1) ON CONFLICT(key_id,period) DO UPDATE SET calls=calls+1"),
    "INSERT INTO usage_monthly (key_id,period,calls) VALUES (?,?,1) ON DUPLICATE KEY UPDATE calls=calls+1");
  assert.equal(translateSql("INSERT INTO g (a,b) VALUES (?,?) ON CONFLICT(a) DO UPDATE SET b=excluded.b, c=excluded.c"), "INSERT INTO g (a,b) VALUES (?,?) ON DUPLICATE KEY UPDATE b=VALUES(b), c=VALUES(c)");
  assert.equal(translateSql("UPDATE usage_monthly SET calls=MAX(calls-1,0) WHERE key_id=?"), "UPDATE usage_monthly SET calls=GREATEST(calls-1,0) WHERE key_id=?");
  assert.equal(translateSql("SELECT MAX(created_at) AS m FROM accounts"), "SELECT MAX(created_at) AS m FROM accounts");
});

test("listenTarget accepts numeric ports and socket paths", () => {
  assert.equal(listenTarget(undefined, 3000), 3000);
  assert.equal(listenTarget("8080", 3000), 8080);
  assert.equal(listenTarget("/tmp/lsnode.sock", 3000), "/tmp/lsnode.sock");
});

test("app.cjs boots like cPanel Setup Node.js App (PORT = socket) and serves MCP over stateless JSON", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "cygnix-cpanel-"));
  const sock = join(dir, "app.sock");
  mkdirSync(join(dir, "webroot", ".well-known", "acme-challenge"), { recursive: true }); writeFileSync(join(dir, "webroot", ".well-known", "acme-challenge", "tok123"), "tok123.thumb");
  const child = spawn(process.execPath, ["app.cjs"], { cwd: root, env: { PATH: process.env.PATH, DCV_WEBROOT: join(dir, "webroot"), PORT: sock, NODE_ENV: "production", PUBLIC_BASE_URL: "https://mcp.cygnixlabs.com", HOSTED_DB: join(dir, "data", "hosted.sqlite"), ADMIN_TOKEN: "t".repeat(40) }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => (log += d)); child.stderr.on("data", d => (log += d));
  try {
    for (let i = 0; i < 100 && !log.includes("up on"); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(log, /up on .*app\.sock/, log);
    const h = await call(sock, "GET", "/health"); assert.equal(h.status, 200); assert.equal(JSON.parse(h.text).ok, true);
    const home = await call(sock, "GET", "/"); assert.equal(home.status, 200); assert.match(home.headers["content-type"], /text\/html/);
    const g = await call(sock, "GET", "/mcp"); assert.equal(g.status, 405);
    const s = await call(sock, "POST", "/v1/signup", { email: "host-test@example.com", accept_terms: true }); assert.equal(s.status, 201, s.text);
    const key = JSON.parse(s.text).api_key; assert.ok(key);
    const hdr = { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${key}` };
    const init = await call(sock, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "1" } } }, hdr);
    assert.equal(init.status, 200, init.text); assert.match(init.headers["content-type"], /application\/json/);
    assert.equal(JSON.parse(init.text).result.serverInfo.name.length > 0, true);
    const list = await call(sock, "POST", "/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, hdr);
    assert.ok(JSON.parse(list.text).result.tools.length >= 5);
    const unauth = await call(sock, "POST", "/mcp", { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, { accept: "application/json, text/event-stream" });
    assert.equal(unauth.status, 401); assert.match(unauth.headers["www-authenticate"] || "", /Bearer/);
    assert.ok(existsSync(join(dir, "data", "hosted.sqlite")));
    const acme = await call(sock, "GET", "/.well-known/acme-challenge/tok123"); assert.equal(acme.status, 200); assert.equal(acme.text, "tok123.thumb");
    assert.equal((await call(sock, "GET", "/.well-known/acme-challenge/..%2F..%2Fdata")).status, 404);
    const meta = await call(sock, "GET", "/.well-known/oauth-protected-resource"); assert.equal(meta.status, 200, "OAuth metadata still served by the app");
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});
