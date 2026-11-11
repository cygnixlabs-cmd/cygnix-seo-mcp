// Picks the storage driver for Node hosts (cPanel, Docker, dev). Cloudflare Workers use D1 directly (worker.ts).
//   HOSTED_DB_DRIVER=sqlite (default)  -> node:sqlite file at HOSTED_DB (Node >= 22.13; no native build needed)
//   HOSTED_DB_DRIVER=mysql             -> MySQL/MariaDB via mysql2 (cPanel "MySQL Databases"): MYSQL_URL or MYSQL_HOST/PORT/USER/PASSWORD/DATABASE
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Db } from "./db.js";

export async function openConfiguredDb(env: Record<string, unknown>, root: string): Promise<{ db: Db; driver: string; where: string }> {
  const driver = String(env.HOSTED_DB_DRIVER || "sqlite").toLowerCase();
  if (driver === "mysql" || driver === "mariadb") {
    const { openMysqlDb } = await import("./mysql-db.js");
    const db = await openMysqlDb(env, join(root, "migrations-mysql"));
    return { db, driver: "mysql", where: String(env.MYSQL_HOST || "MYSQL_URL") };
  }
  if (driver !== "sqlite") throw new Error(`Unknown HOSTED_DB_DRIVER "${driver}" (use sqlite or mysql)`);
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) throw new Error(`HOSTED_DB_DRIVER=sqlite needs Node >= 22.13 (node:sqlite); this is ${process.versions.node}. Pick Node 22/24 in Setup Node.js App, or set HOSTED_DB_DRIVER=mysql.`);
  const path = String(env.HOSTED_DB || join(root, ".data", "hosted.sqlite"));
  if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
  const { openNodeDb } = await import("./node-db.js");
  return { db: openNodeDb(path, join(root, "migrations")), driver: "sqlite", where: path };
}
