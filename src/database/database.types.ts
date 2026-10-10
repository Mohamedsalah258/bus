import type { QueryResultRow } from "pg";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

/**
 * Anything that can run a parameterized query: the pool itself or a client
 * inside a transaction. Repositories accept it so the caller decides whether
 * a statement joins an open transaction.
 */
export interface Queryable {
  query<T extends QueryResultRow = any>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}
