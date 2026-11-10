#!/usr/bin/env node
// Local dev server for the hosted MCP (Node >= 22.13, uses node:sqlite). Not used in production.
//   npm run build && npm run hosted:dev    -> http://localhost:8787/mcp
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openNodeDb } from "./node-db.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.HOSTED_DB ?? join(root, ".data", "hosted.sqlite");
if (dbPath !== ":memory:") await mkdir(dirname(dbPath), { recursive: true });
const env = { PUBLIC_BASE_URL: `http://localhost:${port}`, ...process.env } as Record<string, string>;
const handle = createApp({ db: openNodeDb(dbPath, join(root, "migrations")), env });
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = normalize(join(root, "site", rel));
      if (file.startsWith(join(root, "site")) && extname(file)) {
        try { const body = await readFile(file); res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }); res.end(body); return; } catch { /* fall through */ }
      }
    }
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v); else if (Array.isArray(v)) headers.set(k, v.join(", "));
    const r = await handle(new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "") ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { console.error(e); res.writeHead(500); res.end("internal error"); }
}).listen(port, () => console.log(`cygnix-seo-mcp hosted dev server: http://localhost:${port}/mcp  (db: ${dbPath})`));
