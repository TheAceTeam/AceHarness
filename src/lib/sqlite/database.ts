import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export interface OpenSqliteDatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeoutMs?: number;
}

export interface SqliteStatement {
  all(...params: unknown[]): any[];
  get(...params: unknown[]): any;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma(sql: string, options?: { simple?: boolean }): any;
  close(): void;
}

class NodeSqliteDatabase implements SqliteDatabase {
  constructor(private readonly database: DatabaseSync) {}

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return this.database.prepare(sql);
  }

  pragma(sql: string, options: { simple?: boolean } = {}): any {
    const statement = sql.trim().replace(/;$/, '');
    if (/=/.test(statement)) {
      this.database.exec(`PRAGMA ${statement}`);
      return undefined;
    }
    const rows = this.database.prepare(`PRAGMA ${statement}`).all();
    if (!options.simple) return rows;
    const first = rows[0];
    return first ? first[Object.keys(first)[0]] : undefined;
  }

  close(): void {
    this.database.close();
  }
}

export function openSqliteDatabase(filename: string, options: OpenSqliteDatabaseOptions = {}): SqliteDatabase {
  if (options.fileMustExist && filename !== ':memory:' && !existsSync(filename)) {
    throw new Error(`SQLite database does not exist: ${filename}`);
  }
  const database = new DatabaseSync(filename, { readOnly: options.readonly });
  const db = new NodeSqliteDatabase(database);
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(options.timeoutMs ?? 5000))}`);
  return db;
}

export function withImmediateTransaction<T>(db: Pick<SqliteDatabase, 'exec'>, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the operation failure when best-effort rollback also fails.
    }
    throw error;
  }
}
