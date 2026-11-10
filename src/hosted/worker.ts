// Cloudflare Workers entry. Static pages in /site are served by Workers Static Assets before this runs.
import { createApp } from "./app.js";
import type { Db } from "./db.js";
import type { HostedEnv } from "./env.js";

interface WorkerEnv extends HostedEnv { DB: Db; ASSETS?: { fetch(req: Request): Promise<Response> } }
let cached: { env: WorkerEnv; handle: (r: Request) => Promise<Response> } | null = null;

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    if (!cached || cached.env !== env) cached = { env, handle: createApp({ db: env.DB, env }) };
    const res = await cached.handle(req);
    if (res.status === 404 && req.method === "GET" && env.ASSETS) { const a = await env.ASSETS.fetch(req); if (a.status !== 404) return a; }
    return res;
  },
};
