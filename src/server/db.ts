export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
}
export interface Env {
  DB: Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
export function database(env: Env): Database {
  if (!env.DB) throw new Error("STORAGE_UNAVAILABLE");
  return env.DB;
}
