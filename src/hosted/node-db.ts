// node:sqlite adapter exposing the D1-style Db interface (Node >= 22.13). Local dev + tests only.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Db, DbStatement } from "./db.js";

export function openNodeDb(path = ":memory:", migrationsDir?: string): Db & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  if (migrationsDir) for (const f of readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(migrationsDir, f), "utf8"));
  const stmt = (sql: string, params: unknown[] = []): DbStatement => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    first: async <T>() => (db.prepare(sql).get(...(params as never[])) as T) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(params as never[])) as T[] }),
    run: async () => { const r = db.prepare(sql).run(...(params as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql: string) => stmt(sql), close: () => db.close() };
}
