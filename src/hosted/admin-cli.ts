#!/usr/bin/env node
// Admin CLI. Talks to the /admin API of a running server (local or production).
//   CYGNIX_ADMIN_URL=http://localhost:8787 CYGNIX_ADMIN_TOKEN=... node dist/hosted/admin-cli.js <command>
const HELP = `cygnix-admin <command>
  accounts                         list accounts
  account <id|email>               show plan, usage, keys
  create <email> [tier] [label]    create account + first key (tier: free|pro|growth|agency)
  tier <id|email> <tier>           set tier (manual comp / support)
  suspend <id|email> | unsuspend <id|email>
  key <id|email> [label]           issue another key (no tier limit)
  revoke <key_id>                  revoke a key (also kills its OAuth tokens)
  rotate <key_id>                  issue a replacement key and revoke the old one
Env: CYGNIX_ADMIN_URL (default http://localhost:8787), CYGNIX_ADMIN_TOKEN (required)`;

const base = (process.env.CYGNIX_ADMIN_URL ?? "http://localhost:8787").replace(/\/+$/, "");
const token = process.env.CYGNIX_ADMIN_TOKEN;
async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/admin${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) { console.error(`HTTP ${r.status}: ${t}`); process.exit(1); } return JSON.parse(t);
}
const [cmd, a, b, c] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help") { console.log(HELP); process.exit(0); }
if (!token) { console.error("Set CYGNIX_ADMIN_TOKEN"); process.exit(1); }
const e = encodeURIComponent;
const out = await ({
  accounts: () => call("GET", "/accounts"),
  account: () => call("GET", `/accounts/${e(a)}`),
  create: () => call("POST", "/accounts", { email: a, tier: b ?? "free", label: c }),
  tier: () => call("POST", `/accounts/${e(a)}/tier`, { tier: b }),
  suspend: () => call("POST", `/accounts/${e(a)}/suspend`, {}),
  unsuspend: () => call("POST", `/accounts/${e(a)}/unsuspend`, {}),
  key: () => call("POST", `/accounts/${e(a)}/keys`, { label: b }),
  revoke: () => call("POST", `/keys/${e(a)}/revoke`, {}),
  rotate: () => call("POST", `/keys/${e(a)}/rotate`, {}),
} as Record<string, () => Promise<unknown>>)[cmd]?.() ?? (console.error(HELP), process.exit(1));
console.log(JSON.stringify(out, null, 2));
