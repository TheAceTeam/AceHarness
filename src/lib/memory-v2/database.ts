import { existsSync, mkdirSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'path';
import Database from 'better-sqlite3';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import {
  MEMORY_V2_MIGRATIONS,
  MEMORY_V2_SCHEMA_VERSION,
  MEMORY_V2_SQLITE_PRAGMAS,
} from './schema';

export type MemoryV2Database = Database.Database;

export interface OpenMemoryV2DatabaseOptions {
  /**
   * Omit for the canonical V2 store. `:memory:` is available only while
   * `NODE_ENV` is `test` for isolated tests.
   */
  filename?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
  timeoutMs?: number;
}

export interface OpenMemoryV2DatabaseResult {
  db: MemoryV2Database;
  filename: string;
  created: boolean;
}

export function getMemoryV2DatabasePath(): string {
  return getWorkspaceDataFile('memory-v2.sqlite');
}

const MEMORY_V2_FILENAME = 'memory-v2.sqlite';
const IN_MEMORY_DATABASE = ':memory:';
const ATTACH_STYLE_INPUT = /(?:^|[\s;])attach(?:\s+database)?(?:\s|:|$)|^file:|[?#]/i;
const LEGACY_OR_ARCHIVE_ROOT = /^(?:archive|archives|legacy)(?:[-_.].*)?$/i;

function normalizePathForComparison(input: string): string {
  const normalized = resolve(input);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathsMatch(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function isInsidePath(root: string, target: string): boolean {
  const relativePath = relative(normalizePathForComparison(root), normalizePathForComparison(target));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function inspectPhysicalPath(absolutePath: string): string {
  try {
    if (existsSync(absolutePath)) return realpathSync.native(absolutePath);
    const parentPath = dirname(absolutePath);
    if (existsSync(parentPath)) return resolve(realpathSync.native(parentPath), basename(absolutePath));
  } catch {
    // The lexical path remains sufficient for a not-yet-created canonical database.
  }
  return absolutePath;
}

function assertNoAttachStyleInput(filename: string): void {
  if (!filename || filename.includes('\0') || /[\r\n]/.test(filename) || ATTACH_STYLE_INPUT.test(filename)) {
    throw new Error('Memory V2 database path rejects SQLite URI and ATTACH-style inputs');
  }
}

function isLegacyOrArchiveLocation(absolutePath: string): boolean {
  const segments = absolutePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const filename = segments.length ? segments[segments.length - 1].toLowerCase() : undefined;
  if (filename === 'memory.sqlite') return true;
  return segments.slice(0, -1).some((segment) => LEGACY_OR_ARCHIVE_ROOT.test(segment));
}

function assertIsolatedV2Path(absolutePath: string): void {
  const legacyMemoryRoot = resolve(getWorkspaceDataFile('memory'));
  const candidates = [absolutePath, inspectPhysicalPath(absolutePath)];
  if (candidates.some((candidate) => isLegacyOrArchiveLocation(candidate) || isInsidePath(legacyMemoryRoot, candidate))) {
    throw new Error('Memory V2 database path rejects legacy memory.sqlite and archive or legacy roots');
  }
}

function resolveDatabaseFilename(options: OpenMemoryV2DatabaseOptions): string {
  if (Object.prototype.hasOwnProperty.call(options, 'testPath')) {
    throw new Error('Memory V2 database does not accept test filesystem paths; use isolated :memory: instead');
  }

  const canonicalPath = resolve(getMemoryV2DatabasePath());
  const requestedFilename = options.filename === undefined
    ? canonicalPath
    : String(options.filename).trim();
  if (requestedFilename === IN_MEMORY_DATABASE) {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Memory V2 database permits :memory: only when NODE_ENV is test');
    }
    return IN_MEMORY_DATABASE;
  }
  assertNoAttachStyleInput(requestedFilename);
  const absoluteFilename = resolve(requestedFilename);
  assertIsolatedV2Path(absoluteFilename);
  if (!pathsMatch(absoluteFilename, canonicalPath) || basename(absoluteFilename).toLowerCase() !== MEMORY_V2_FILENAME) {
    throw new Error('Memory V2 database must use canonical memory-v2.sqlite or isolated :memory:');
  }
  return canonicalPath;
}

export function applyMemoryV2Migrations(db: MemoryV2Database): void {
  db.exec(MEMORY_V2_SQLITE_PRAGMAS);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_v2_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM memory_v2_schema_migrations ORDER BY version ASC').all() as Array<{ version: number }>;
  const highestAppliedVersion = appliedRows.length ? appliedRows[appliedRows.length - 1].version : 0;
  if (highestAppliedVersion > MEMORY_V2_SCHEMA_VERSION) {
    throw new Error(`Memory V2 database schema ${highestAppliedVersion} is newer than this server (${MEMORY_V2_SCHEMA_VERSION})`);
  }

  const appliedVersions = new Set(appliedRows.map((row) => Number(row.version)));
  for (const migration of MEMORY_V2_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    const migrate = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(`
        INSERT INTO memory_v2_schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, new Date().toISOString());
    });
    if (migration.requiresForeignKeysOff) {
      // SQLite must have foreign keys disabled before rebuilding a referenced table.
      db.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;');
      try {
        migrate();
      } finally {
        db.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;');
      }
    } else {
      migrate();
    }
  }
}

export function openMemoryV2Database(options: OpenMemoryV2DatabaseOptions = {}): OpenMemoryV2DatabaseResult {
  const filename = resolveDatabaseFilename(options);
  const created = filename !== IN_MEMORY_DATABASE && !existsSync(filename);
  if (filename !== IN_MEMORY_DATABASE) mkdirSync(dirname(filename), { recursive: true });

  const dbOptions: Database.Options = { timeout: options.timeoutMs ?? 5000 };
  if (options.readonly !== undefined) dbOptions.readonly = options.readonly;
  if (options.fileMustExist !== undefined) dbOptions.fileMustExist = options.fileMustExist;
  const db = new Database(filename, dbOptions);
  applyMemoryV2Migrations(db);
  return { db, filename, created };
}

export function withMemoryV2ImmediateTransaction<T>(db: MemoryV2Database, fn: () => T): T {
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
