import { createApp } from "../dist/hosted/app.js";
import { openNodeDb } from "../dist/hosted/node-db.js";
import { Store } from "../dist/hosted/store.js";
export const BASE = "https://mcp.test";
export function makeApp(env = {}, opts = {}) {
  const db = openNodeDb(":memory:", new URL("../migrations", import.meta.url).pathname);
  const handle = createApp({ db, env: { PUBLIC_BASE_URL: BASE, ...env }, fetchImpl: opts.fetchImpl, webFetch: opts.webFetch });
  const store = new Store(db);
  const req = (path, init = {}) => handle(new Request(BASE + path, init));
  const post = (path, body, headers = {}) => req(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  let id = 0;
  const rpc = async (token, method, params = {}, extraHeaders = {}) => {
    const res = await post("/mcp", { jsonrpc: "2.0", id: ++id, method, params }, { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders });
    const text = await res.text(); return { res, status: res.status, body: text ? JSON.parse(text) : null };
  };
  const call = (token, name, args = {}) => rpc(token, "tools/call", { name, arguments: args });
  const signup = async (email = `u${Math.random().toString(36).slice(2)}@example.com`) => { const r = await post("/v1/signup", { email, accept_terms: true }); return r.json(); };
  return { db, store, handle, req, post, rpc, call, signup };
}
/** Mock fetch: routes is [[matcher(url, init) => bool, (url, init) => Response | object]]. Records calls. */
export function mockFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, init });
    for (const [m, h] of routes) if (typeof m === "string" ? u.startsWith(m) : m(u, init)) { const r = await h(u, init); return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } }); }
    return new Response("not mocked: " + u, { status: 599 });
  };
  f.calls = calls; return f;
}
