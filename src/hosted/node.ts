#!/usr/bin/env node
// Local dev / Docker server for the hosted MCP.
//   npm run build && npm run hosted:dev    -> http://localhost:8787/mcp
// Storage: HOSTED_DB_DRIVER=sqlite (default, node:sqlite at HOSTED_DB) or mysql (see open-db.ts).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeServer, listenTarget } from "./node-server.js";
import { openConfiguredDb } from "./open-db.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = listenTarget(process.env.PORT, 8787);
const env = { PUBLIC_BASE_URL: typeof target === "number" ? `http://localhost:${target}` : "", ...process.env } as Record<string, string>;
const { db, driver, where } = await openConfiguredDb(env, root);
createNodeServer({ db, env, siteDir: join(root, "site") }).listen(target, () => console.log(`cygnix-seo-mcp hosted server: ${env.PUBLIC_BASE_URL || target}/mcp  (db: ${driver} ${where})`));
