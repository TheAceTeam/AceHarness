import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';

export type MemoryScope = 'role' | 'project' | 'workflow' | 'chat';
export type MemoryKind = 'base' | 'summary' | 'experience' | 'review' | 'decision' | 'quality' | 'session';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  key: string;
  kind: MemoryKind;
  title: string;
  content: string;
  source: string;
  runId?: string;
  configFile?: string;
  agent?: string;
  tags?: string[];
  createdAt: string;
}

interface MemoryBucket {
  scope: MemoryScope;
  key: string;
  updatedAt: string;
  entries: MemoryEntry[];
}

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): any[];
    get(...params: unknown[]): any;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  };
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
};

const DB_PATH = getWorkspaceDataFile('memory', 'memory.sqlite');
const MAX_BUCKET_ENTRIES = 60;

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonArray(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof input !== 'string' || !input.trim()) return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function stableJson(input: unknown): string {
  return JSON.stringify(input ?? []);
}

function normalizeLimit(limit?: number): number {
  const parsed = Number(limit || 5);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function openDb(): SqliteDatabase {
  const nodeRequire = eval('require') as NodeRequire;
  const BetterSqlite = nodeRequire('better-sqlite3') as any;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new BetterSqlite(DB_PATH) as SqliteDatabase;
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      run_id TEXT,
      config_file TEXT,
      agent TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entries_scope_key_created
      ON memory_entries(scope, key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_entries_scope_key_kind
      ON memory_entries(scope, key, kind);
    CREATE INDEX IF NOT EXISTS idx_memory_entries_agent_created
      ON memory_entries(agent, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_entries_run_created
      ON memory_entries(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_entries_config_created
      ON memory_entries(config_file, created_at DESC);
  `);
  return db;
}

function rowToEntry(row: any): MemoryEntry {
  return {
    id: String(row.id || ''),
    scope: row.scope as MemoryScope,
    key: String(row.key || ''),
    kind: row.kind as MemoryKind,
    title: String(row.title || ''),
    content: String(row.content || ''),
    source: String(row.source || ''),
    runId: row.run_id || undefined,
    configFile: row.config_file || undefined,
    agent: row.agent || undefined,
    tags: parseJsonArray(row.tags_json),
    createdAt: String(row.created_at || ''),
  };
}

function insertEntry(db: SqliteDatabase, entry: MemoryEntry, updatedAt: string): void {
  db.prepare(`
    INSERT INTO memory_entries (
      id, scope, key, kind, title, content, source,
      run_id, config_file, agent, tags_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      scope = excluded.scope,
      key = excluded.key,
      kind = excluded.kind,
      title = excluded.title,
      content = excluded.content,
      source = excluded.source,
      run_id = excluded.run_id,
      config_file = excluded.config_file,
      agent = excluded.agent,
      tags_json = excluded.tags_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).run(
    entry.id,
    entry.scope,
    entry.key,
    entry.kind,
    entry.title,
    entry.content,
    entry.source,
    entry.runId || null,
    entry.configFile || null,
    entry.agent || null,
    stableJson(entry.tags || []),
    entry.createdAt,
    updatedAt,
  );
}

function pruneBucket(db: SqliteDatabase, scope: MemoryScope, key: string): void {
  db.prepare(`
    DELETE FROM memory_entries
    WHERE scope = ? AND key = ? AND id NOT IN (
      SELECT id FROM memory_entries
      WHERE scope = ? AND key = ?
      ORDER BY created_at DESC, updated_at DESC
      LIMIT ?
    )
  `).run(scope, key, scope, key, MAX_BUCKET_ENTRIES);
}

export async function getMemoryBucket(options: {
  scope: MemoryScope;
  key: string;
}): Promise<MemoryBucket> {
  const db = openDb();
  try {
    const rows = db
      .prepare('SELECT * FROM memory_entries WHERE scope = ? AND key = ? ORDER BY created_at DESC, updated_at DESC')
      .all(options.scope, options.key);
    const updatedRow = db
      .prepare('SELECT MAX(updated_at) AS updated_at FROM memory_entries WHERE scope = ? AND key = ?')
      .get(options.scope, options.key);
    return {
      scope: options.scope,
      key: options.key,
      updatedAt: updatedRow?.updated_at || nowIso(),
      entries: rows.map(rowToEntry),
    };
  } finally {
    db.close();
  }
}

export async function replaceMemoryEntries(options: {
  scope: MemoryScope;
  key: string;
  entries: Array<Omit<MemoryEntry, 'scope' | 'key' | 'id' | 'createdAt'> & { id?: string; createdAt?: string }>;
}): Promise<MemoryBucket> {
  const db = openDb();
  const updatedAt = nowIso();
  const entries = options.entries
    .filter((entry) => normalizeText(entry.title) && normalizeText(entry.content))
    .map((entry, index): MemoryEntry => ({
      id: entry.id || `${options.scope}:${options.key}:${updatedAt}:${index}:${randomUUID()}`,
      scope: options.scope,
      key: options.key,
      kind: entry.kind,
      title: normalizeText(entry.title),
      content: normalizeText(entry.content),
      source: normalizeText(entry.source) || 'unknown',
      runId: entry.runId,
      configFile: entry.configFile,
      agent: entry.agent,
      tags: parseJsonArray(entry.tags),
      createdAt: entry.createdAt || updatedAt,
    }));

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM memory_entries WHERE scope = ? AND key = ?').run(options.scope, options.key);
    for (const entry of entries) insertEntry(db, entry, updatedAt);
    pruneBucket(db, options.scope, options.key);
  });
  try {
    tx();
  } finally {
    db.close();
  }
  return getMemoryBucket({ scope: options.scope, key: options.key });
}

export async function clearMemoryEntries(options: {
  scope: MemoryScope;
  key: string;
}): Promise<void> {
  const db = openDb();
  try {
    db.prepare('DELETE FROM memory_entries WHERE scope = ? AND key = ?').run(options.scope, options.key);
  } finally {
    db.close();
  }
}

export async function appendMemoryEntries(
  entries: Array<Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string }>
): Promise<void> {
  const db = openDb();
  const updatedAt = nowIso();
  const normalizedEntries: MemoryEntry[] = entries
    .filter((entry) => entry.scope && normalizeText(entry.key) && normalizeText(entry.title) && normalizeText(entry.content))
    .map((entry): MemoryEntry => ({
      id: entry.id || `${entry.scope}:${entry.key}:${Date.now()}:${randomUUID()}`,
      scope: entry.scope,
      key: normalizeText(entry.key),
      kind: entry.kind,
      title: normalizeText(entry.title),
      content: normalizeText(entry.content),
      source: normalizeText(entry.source) || 'unknown',
      runId: entry.runId,
      configFile: entry.configFile,
      agent: entry.agent,
      tags: parseJsonArray(entry.tags),
      createdAt: entry.createdAt || updatedAt,
    }));

  const tx = db.transaction((items: MemoryEntry[]) => {
    const touched = new Set<string>();
    for (const entry of items) {
      insertEntry(db, entry, updatedAt);
      touched.add(`${entry.scope}\n${entry.key}`);
    }
    for (const item of touched) {
      const [scope, key] = item.split('\n') as [MemoryScope, string];
      pruneBucket(db, scope, key);
    }
  });
  try {
    tx(normalizedEntries);
  } finally {
    db.close();
  }
}

export async function listMemoryEntries(options: {
  scope: MemoryScope;
  key: string;
  limit?: number;
}): Promise<MemoryEntry[]> {
  const db = openDb();
  try {
    const rows = db
      .prepare('SELECT * FROM memory_entries WHERE scope = ? AND key = ? ORDER BY created_at DESC, updated_at DESC LIMIT ?')
      .all(options.scope, options.key, normalizeLimit(options.limit));
    return rows.map(rowToEntry);
  } finally {
    db.close();
  }
}

export async function listScopeMemories(options: {
  scope: MemoryScope;
  limit?: number;
}): Promise<Array<{ key: string; updatedAt: string; entries: MemoryEntry[] }>> {
  const limit = normalizeLimit(options.limit || 10);
  const db = openDb();
  try {
    const buckets = db.prepare(`
      SELECT key, MAX(updated_at) AS updated_at
      FROM memory_entries
      WHERE scope = ?
      GROUP BY key
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(options.scope, limit);
    return buckets.map((bucket: any) => {
      const rows = db
        .prepare('SELECT * FROM memory_entries WHERE scope = ? AND key = ? ORDER BY created_at DESC, updated_at DESC LIMIT ?')
        .all(options.scope, bucket.key, MAX_BUCKET_ENTRIES);
      return {
        key: String(bucket.key || ''),
        updatedAt: String(bucket.updated_at || ''),
        entries: rows.map(rowToEntry),
      };
    });
  } finally {
    db.close();
  }
}

export function buildMemoryPromptBlock(
  title: string,
  entries: MemoryEntry[],
  options?: { maxItems?: number }
): string {
  const list = entries.slice(0, Math.max(1, options?.maxItems || 3));
  if (!list.length) return '';
  return [
    `## ${title}`,
    ...list.map((entry) => [
      `- ${entry.title}`,
      `  - 类型: ${entry.kind}`,
      `  - 来源: ${entry.source}`,
      `  - 内容: ${entry.content}`,
    ].join('\n')),
  ].join('\n');
}
