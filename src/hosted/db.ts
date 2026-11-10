// Minimal D1-compatible database interface. Cloudflare D1 satisfies it natively;
// src/hosted/node-db.ts adapts node:sqlite to it for local runs and tests.
export interface DbResult { meta?: { changes?: number } }
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<DbResult>;
}
export interface Db {
  prepare(sql: string): DbStatement;
  batch?(stmts: DbStatement[]): Promise<unknown[]>;
}
