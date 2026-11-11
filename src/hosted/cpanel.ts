// cPanel "Setup Node.js App" entry (CloudLinux Node.js Selector; runs under LiteSpeed lsnode or Phusion Passenger).
// Loaded by app.cjs (the Application startup file), which works whether the runner require()s or imports it.
// The runner sets PORT (often a socket path, not a number) and the env vars entered in the Selector UI.
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createNodeServer, listenTarget } from "./node-server.js";
import { openConfiguredDb } from "./open-db.js";

export async function start(): Promise<void> {
  const root = process.env.CYGNIX_APP_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const env = { ...process.env } as Record<string, string>;
  if (!env.PUBLIC_BASE_URL) env.PUBLIC_BASE_URL = "https://mcp.cygnixlabs.com";
  if (!env.HOSTED_DB && (env.HOSTED_DB_DRIVER || "sqlite") === "sqlite") env.HOSTED_DB = join(root, "data", "hosted.sqlite");
  const { db, driver, where } = await openConfiguredDb(env, root);
  const target = listenTarget(process.env.PORT, 3000);
  // Subdomain document root that cPanel created (AutoSSL writes HTTP validation files there). Override with DCV_WEBROOT.
  const host = new URL(env.PUBLIC_BASE_URL).hostname;
  const dcv = env.DCV_WEBROOT || [join(process.env.HOME || "", host), join(process.env.HOME || "", "public_html", host.split(".")[0])].find(d => existsSync(d));
  createNodeServer({ db, env, siteDir: join(root, "site"), dcvWebroot: dcv }).listen(target, () => console.log(`[cygnix-seo-mcp] up on ${String(target)} base=${env.PUBLIC_BASE_URL} db=${driver}:${where} node=${process.versions.node}`));
}
