// MySQL / MariaDB adapter exposing the D1-style Db interface, for cPanel hosts where node:sqlite is unavailable
// (Node < 22.13) or a managed DB is preferred. Pure JS (mysql2), so no native build on shared hosting.
// The store's SQL is written for SQLite/D1; translateSql() maps the few dialect differences.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Db, DbStatement } from "./db.js";

/** SQLite -> MySQL: upserts, INSERT OR IGNORE, MAX(a,b). */
export function translateSql(sql: string): string {
  let s = sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT IGNORE INTO").replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, "REPLACE INTO");
  s = s.replace(/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/gi, "ON DUPLICATE KEY UPDATE");
  s = s.replace(/\bexcluded\.(\w+)/gi, "VALUES($1)");
  // Two-argument scalar MAX(a, b) -> GREATEST(a, b). Aggregate MAX(col) has no top-level comma and is left alone.
  s = s.replace(/\bMAX\(([^(),]+),([^(),]+)\)/gi, "GREATEST($1,$2)");
  return s;
}

type Pool = { query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>; end(): Promise<void> };

export async function openMysqlDb(env: Record<string, unknown>, migrationsDir?: string): Promise<Db & { close(): Promise<void> }> {
  let mysql: { createPool(o: unknown): Pool };
  try { mysql = (await import("mysql2/promise" as string)).default; }
  catch { throw new Error("HOSTED_DB_DRIVER=mysql needs the mysql2 package: run `npm install mysql2` (the cPanel bundle includes it)."); }
  const common = { waitForConnections: true, connectionLimit: Number(env.MYSQL_POOL || 5), decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: false, charset: "utf8mb4", multipleStatements: false, timezone: "Z" };
  const pool: Pool = env.MYSQL_URL
    ? mysql.createPool({ uri: String(env.MYSQL_URL), ...common })
    : mysql.createPool({ host: String(env.MYSQL_HOST || "localhost"), port: Number(env.MYSQL_PORT || 3306), user: String(env.MYSQL_USER || ""), password: String(env.MYSQL_PASSWORD || ""), database: String(env.MYSQL_DATABASE || ""), ...(env.MYSQL_SOCKET ? { socketPath: String(env.MYSQL_SOCKET) } : {}), ...common });
  if (migrationsDir) await migrate(pool, migrationsDir);
  const stmt = (sql: string, params: unknown[] = []): DbStatement => {
    const q = translateSql(sql);
    const p = params.map(v => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v));
    return {
      bind: (...v: unknown[]) => stmt(sql, v),
      first: async <T>() => { const [rows] = await pool.query(q, p); return ((rows as T[])[0] ?? null) as T | null; },
      all: async <T>() => { const [rows] = await pool.query(q, p); return { results: rows as T[] }; },
      run: async () => {
        const [r] = await pool.query(q, p) as [{ affectedRows?: number }, unknown];
        // ON DUPLICATE KEY UPDATE reports 2 for an update; callers only test for 0 vs >0.
        return { meta: { changes: Number(r?.affectedRows ?? 0) } };
      },
    };
  };
  return { prepare: (sql: string) => stmt(sql), close: () => pool.end() };
}

/** Applies migrations-mysql/*.sql once each (statements split on ';' at line end). */
async function migrate(pool: Pool, dir: string) {
  await pool.query("CREATE TABLE IF NOT EXISTS _cygnix_migrations (name VARCHAR(191) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin");
  const [rows] = await pool.query("SELECT name FROM _cygnix_migrations");
  const done = new Set((rows as { name: string }[]).map(r => r.name));
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    const text = readFileSync(join(dir, f), "utf8").split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    for (const s of text.split(/;\s*(?:\n|$)/).map(x => x.trim()).filter(Boolean)) await pool.query(s);
    await pool.query("INSERT INTO _cygnix_migrations (name) VALUES (?)", [f]);
  }
}
