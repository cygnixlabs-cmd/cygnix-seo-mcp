// Node HTTP front for the hosted MCP: used by the local dev server (node.ts), the cPanel / Passenger / LiteSpeed
// entry (cpanel.ts) and the Docker fallback. Serves /site statically, everything else goes to createApp().
// Streamable HTTP runs in stateless JSON-response mode (no SSE), so proxies that buffer responses are fine.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";
import { createApp } from "./app.js";
import type { Db } from "./db.js";

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const MAX_BODY = 2 * 1024 * 1024;

export interface NodeServerOptions {
  db: Db; env: Record<string, unknown>; siteDir: string;
  /** cPanel AutoSSL / Let's Encrypt / Sectigo HTTP validation: serve /.well-known/acme-challenge/* and /.well-known/pki-validation/*
   *  from the subdomain's document root (cPanel writes the token files there) so certificates issue and renew while Node owns the domain. */
  dcvWebroot?: string;
}
const DCV = /^\/\.well-known\/(acme-challenge|pki-validation)\/[A-Za-z0-9._-]+$/;

export function createNodeServer(o: NodeServerOptions): Server {
  const handle = createApp({ db: o.db, env: o.env });
  const site = normalize(o.siteDir);
  return createServer(async (req, res) => {
    try {
      // Behind cPanel/LiteSpeed/Passenger the Host header is the public host; fall back to PUBLIC_BASE_URL.
      const base = String(o.env.PUBLIC_BASE_URL || `http://${req.headers.host || "localhost"}`);
      const url = new URL(req.url ?? "/", base);
      if ((req.method === "GET" || req.method === "HEAD") && o.dcvWebroot && DCV.test(url.pathname)) {
        try { const body = await readFile(join(o.dcvWebroot, url.pathname)); res.writeHead(200, { "Content-Type": "text/plain" }); res.end(req.method === "HEAD" ? undefined : body); return; }
        catch { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
        const file = normalize(join(site, rel));
        if ((file + sep).startsWith(site + sep) && extname(file)) {
          try {
            const body = await readFile(file);
            res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
            res.end(req.method === "HEAD" ? undefined : body); return;
          } catch { /* not a file: fall through to the app */ }
        }
      }
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of req) { size += (c as Buffer).length; if (size > MAX_BODY) { res.writeHead(413, { "Content-Type": "application/json" }); res.end('{"error":{"code":"too_large","message":"Request body over 2 MB"}}'); return; } chunks.push(c as Buffer); }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v); else if (Array.isArray(v)) headers.set(k, v.join(", "));
      const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
      const r = await handle(new Request(url, { method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : Buffer.concat(chunks) }));
      if (r.status === 404 && method === "GET" && !extname(url.pathname)) {
        try { const nf = await readFile(join(site, "404.html")); res.writeHead(404, { "Content-Type": TYPES[".html"] }); res.end(nf); return; } catch { /* no 404 page */ }
      }
      const out: Record<string, string | string[]> = {};
      r.headers.forEach((v, k) => { out[k] = v; });
      const cookies = (r.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      if (cookies.length) out["set-cookie"] = cookies;
      // Tell LiteSpeed/nginx-style proxies not to buffer (harmless elsewhere).
      out["x-accel-buffering"] = "no";
      res.writeHead(r.status, out);
      res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
    } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" }); res.end("internal error"); }
  });
}

/** PORT may be a number (Docker, dev) or a socket path / pipe name (Passenger, LiteSpeed lsnode). */
export function listenTarget(port: string | undefined, fallback: number): number | string {
  if (port === undefined || port === "") return fallback;
  return /^\d+$/.test(port) ? Number(port) : port;
}
