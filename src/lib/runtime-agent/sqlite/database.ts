import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { openSqliteDatabase, withImmediateTransaction as withSqliteImmediateTransaction, type SqliteDatabase } from '@/lib/sqlite/database';
import { RUNTIME_SQLITE_PRAGMAS, RUNTIME_SQLITE_SCHEMA } from './schema';

export type RuntimeSqliteDatabase = SqliteDatabase;

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

  const db = openSqliteDatabase(filename, options);
  bootstrapRuntimeSqlite(db);
  return db;
}

export function withImmediateTransaction<T>(
  db: RuntimeSqliteDatabase,
  fn: () => T,
): T {
  return withSqliteImmediateTransaction(db, fn);
}
