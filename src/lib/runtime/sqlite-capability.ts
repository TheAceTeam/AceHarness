import Database from 'better-sqlite3';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { RuntimeDatabaseGrant, RuntimeSqliteDatabaseGrant } from '@/lib/runtime/database-capabilities';

export class RuntimeSqliteError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 400, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function getSqliteGrant(grant: RuntimeDatabaseGrant) {
  if (!grant.sqlite?.enabled) throw new RuntimeSqliteError('SQLITE_DISABLED', 403);
  return grant.sqlite;
}

export function getGrantedDatabase(grant: RuntimeDatabaseGrant, name: string): RuntimeSqliteDatabaseGrant {
  const sqlite = getSqliteGrant(grant);
  const db = sqlite.databases.find((item) => item.name === name);
  if (!db) throw new RuntimeSqliteError('SQLITE_DB_NOT_ALLOWED', 403);
  const workspaceRoot = path.resolve(grant.workspaceRoot);
  const absolutePath = path.resolve(db.absolutePath);
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new RuntimeSqliteError('SQLITE_PATH_ESCAPE', 403);
  }
  return { ...db, absolutePath };
}

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '').trim();
}

function ensureSingleStatement(sql: string): string {
  const trimmed = stripTrailingSemicolon(sql);
  if (!trimmed) throw new RuntimeSqliteError('SQLITE_SQL_EMPTY', 400);
  const withoutStrings = trimmed.replace(/'([^']|'')*'/g, "''").replace(/"([^"]|"")*"/g, '""');
  if (withoutStrings.includes(';')) throw new RuntimeSqliteError('SQLITE_UNSAFE_SQL', 400);
  return trimmed;
}

function rejectUnsafeSql(sql: string): void {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
  const banned = [
    /\battach\b/,
    /\bdetach\b/,
    /\bload_extension\s*\(/,
    /\bvacuum\s+into\b/,
    /(^|\s)\.read\b/,
    /(^|\s)\.shell\b/,
    /\bpragma\s+writable_schema\b/,
  ];
  if (banned.some((pattern) => pattern.test(normalized))) {
    throw new RuntimeSqliteError('SQLITE_UNSAFE_SQL', 400);
  }
}

export function validateQuerySql(sql: string): string {
  const trimmed = ensureSingleStatement(sql);
  rejectUnsafeSql(trimmed);
  const normalized = trimmed.replace(/^\s*\([^)]*\)\s*/g, '').trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    throw new RuntimeSqliteError('SQLITE_UNSAFE_SQL', 400);
  }
  return trimmed;
}

export function validateExecSql(sql: string): string {
  const trimmed = ensureSingleStatement(sql);
  rejectUnsafeSql(trimmed);
  const normalized = trimmed.toLowerCase();
  const allowed = /^(create\s+(table|index|unique\s+index)|drop\s+table|alter\s+table|insert|update|delete|replace|pragma\s+(foreign_keys|journal_mode|synchronous)\b)/;
  if (!allowed.test(normalized)) throw new RuntimeSqliteError('SQLITE_UNSAFE_SQL', 400);
  return trimmed;
}

function normalizeParams(params: unknown): unknown[] {
  return Array.isArray(params) ? params : [];
}

function openDatabase(db: RuntimeSqliteDatabaseGrant, readonly = false) {
  if (!existsSync(db.absolutePath) && readonly) {
    throw new RuntimeSqliteError('SQLITE_DB_NOT_FOUND', 404);
  }
  return new Database(db.absolutePath, { readonly });
}

export async function listRuntimeSqliteDatabases(grant: RuntimeDatabaseGrant) {
  return getSqliteGrant(grant).databases.map((db) => ({
    name: db.name,
    path: db.relativePath,
    allowCreate: db.allowCreate,
    allowDelete: db.allowDelete,
    readOnly: db.readOnly,
    exists: existsSync(db.absolutePath),
  }));
}

export async function createRuntimeSqliteDatabase(grant: RuntimeDatabaseGrant, name: string) {
  const dbGrant = getGrantedDatabase(grant, name);
  if (!dbGrant.allowCreate) throw new RuntimeSqliteError('SQLITE_CREATE_NOT_ALLOWED', 403);
  await mkdir(path.dirname(dbGrant.absolutePath), { recursive: true });
  const db = openDatabase(dbGrant, false);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
  } finally {
    db.close();
  }
  return { name: dbGrant.name, path: dbGrant.relativePath, created: true };
}

export async function deleteRuntimeSqliteDatabase(grant: RuntimeDatabaseGrant, name: string) {
  const dbGrant = getGrantedDatabase(grant, name);
  if (!dbGrant.allowDelete) throw new RuntimeSqliteError('SQLITE_DELETE_NOT_ALLOWED', 403);
  for (const file of [dbGrant.absolutePath, `${dbGrant.absolutePath}-wal`, `${dbGrant.absolutePath}-shm`]) {
    if (existsSync(file)) await rm(file, { force: true });
  }
  return { name: dbGrant.name, deleted: true };
}

export async function queryRuntimeSqlite(grant: RuntimeDatabaseGrant, input: { database: string; sql: string; params?: unknown; limit?: number }) {
  const dbGrant = getGrantedDatabase(grant, input.database);
  const sql = validateQuerySql(input.sql);
  const limit = Math.max(1, Math.min(Number(input.limit || 200), 1000));
  const db = openDatabase(dbGrant, true);
  try {
    const rows = db.prepare(sql).all(...normalizeParams(input.params)).slice(0, limit);
    return { rows, rowCount: rows.length };
  } finally {
    db.close();
  }
}

export async function execRuntimeSqlite(grant: RuntimeDatabaseGrant, input: { database: string; sql: string; params?: unknown }) {
  const dbGrant = getGrantedDatabase(grant, input.database);
  if (dbGrant.readOnly) throw new RuntimeSqliteError('SQLITE_READONLY', 403);
  const sql = validateExecSql(input.sql);
  await mkdir(path.dirname(dbGrant.absolutePath), { recursive: true });
  const db = openDatabase(dbGrant, false);
  try {
    const info = db.prepare(sql).run(...normalizeParams(input.params));
    return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid || 0) };
  } finally {
    db.close();
  }
}

export async function transactionRuntimeSqlite(grant: RuntimeDatabaseGrant, input: { database: string; statements: Array<{ sql: string; params?: unknown }> }) {
  const dbGrant = getGrantedDatabase(grant, input.database);
  if (dbGrant.readOnly) throw new RuntimeSqliteError('SQLITE_READONLY', 403);
  const statements = Array.isArray(input.statements) ? input.statements : [];
  if (!statements.length) throw new RuntimeSqliteError('SQLITE_SQL_EMPTY', 400);
  const validated = statements.map((statement) => ({
    sql: validateExecSql(statement.sql),
    params: normalizeParams(statement.params),
  }));
  await mkdir(path.dirname(dbGrant.absolutePath), { recursive: true });
  const db = openDatabase(dbGrant, false);
  try {
    const runAll = db.transaction(() => validated.map((statement) => {
      const info = db.prepare(statement.sql).run(...statement.params);
      return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid || 0) };
    }));
    return { results: runAll() };
  } finally {
    db.close();
  }
}
