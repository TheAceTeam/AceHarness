import { mkdirSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import { RUNTIME_SQLITE_PRAGMAS, RUNTIME_SQLITE_SCHEMA } from './schema';

export type RuntimeSqliteDatabase = Database.Database;

export interface OpenRuntimeSqliteOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeoutMs?: number;
}

export function bootstrapRuntimeSqlite(db: RuntimeSqliteDatabase): void {
  db.exec(RUNTIME_SQLITE_PRAGMAS);
  db.exec(RUNTIME_SQLITE_SCHEMA);
}

export function openRuntimeSqliteDatabase(
  filename: string,
  options: OpenRuntimeSqliteOptions = {},
): RuntimeSqliteDatabase {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const dbOptions: Database.Options = { timeout: options.timeoutMs ?? 5000 };
  if (options.readonly !== undefined) dbOptions.readonly = options.readonly;
  if (options.fileMustExist !== undefined) dbOptions.fileMustExist = options.fileMustExist;

  const db = new Database(filename, dbOptions);
  bootstrapRuntimeSqlite(db);
  return db;
}

export function withImmediateTransaction<T>(
  db: RuntimeSqliteDatabase,
  fn: () => T,
): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
