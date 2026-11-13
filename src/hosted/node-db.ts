// node:sqlite adapter exposing the D1-style Db interface (Node >= 22.13). Local dev + tests only.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Db, DbStatement } from "./db.js";

export function openNodeDb(path = ":memory:", migrationsDir?: string): Db & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  if (migrationsDir) {
    // Apply each migration once (like `wrangler d1 migrations apply`), so ALTER TABLE migrations are safe on a persistent dev DB.
    db.exec("CREATE TABLE IF NOT EXISTS _cygnix_migrations (name TEXT PRIMARY KEY)");
    const done = new Set((db.prepare("SELECT name FROM _cygnix_migrations").all() as { name: string }[]).map(r => r.name));
    for (const f of readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()) {
      if (done.has(f)) continue;
      db.exec(readFileSync(join(migrationsDir, f), "utf8")); db.prepare("INSERT INTO _cygnix_migrations (name) VALUES (?)").run(f);
    }
  }
  const stmt = (sql: string, params: unknown[] = []): DbStatement => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    first: async <T>() => (db.prepare(sql).get(...(params as never[])) as T) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(params as never[])) as T[] }),
    run: async () => { const r = db.prepare(sql).run(...(params as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), close: () => db.close() };
}
