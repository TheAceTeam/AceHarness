import { appendFile, mkdir, readFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { getWorkspaceDataFile, getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { openSqliteDatabase, withImmediateTransaction, type SqliteDatabase } from '@/lib/sqlite/database';

export interface WorkflowEventRecord {
  seq: number;
  runId: string;
  type: string;
  timestamp: string;
  payload: any;
}

export interface WorkflowSnapshotRecord {
  runId: string;
  seq: number;
  version: number;
  updatedAt: string;
  snapshot: any;
}

export interface WorkflowEventStore {
  append(runId: string, type: string, payload: any): Promise<WorkflowEventRecord>;
  appendBatch(runId: string, events: Array<{ type: string; payload: any }>): Promise<WorkflowEventRecord[]>;
  read(runId: string, options?: { afterSeq?: number; limit?: number }): Promise<WorkflowEventRecord[]>;
  saveSnapshot(runId: string, snapshot: any, options?: { seq?: number; version?: number }): Promise<WorkflowSnapshotRecord>;
  getSnapshot(runId: string): Promise<WorkflowSnapshotRecord | null>;
}

interface ClosableWorkflowEventStore extends WorkflowEventStore {
  close?(): void;
}

const EVENT_STORE_SCHEMA_VERSION = 1;
const DB_PATH = getWorkspaceDataFile('workflow-events.sqlite');

function nowIso(): string {
  return new Date().toISOString();
}

function stableJson(input: any): string {
  return JSON.stringify(input ?? null);
}

function parseJson(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 500;
  return Math.max(1, Math.min(5000, Math.floor(Number(limit))));
}

class JsonlWorkflowEventStore implements WorkflowEventStore {
  private runEventFile(runId: string): string {
    return resolve(getWorkspaceRunsDir(), runId, 'events.jsonl');
  }

  private runSnapshotFile(runId: string): string {
    return resolve(getWorkspaceRunsDir(), runId, 'state.snapshot.json');
  }

  async append(runId: string, type: string, payload: any): Promise<WorkflowEventRecord> {
    const existing = await this.read(runId, { limit: 1_000_000 }).catch(() => []);
    const record: WorkflowEventRecord = {
      seq: existing.length > 0 ? existing[existing.length - 1].seq + 1 : 1,
      runId,
      type,
      timestamp: nowIso(),
      payload,
    };
    const file = this.runEventFile(runId);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${stableJson(record)}\n`, 'utf-8');
    return record;
  }

  async appendBatch(runId: string, events: Array<{ type: string; payload: any }>): Promise<WorkflowEventRecord[]> {
    const records: WorkflowEventRecord[] = [];
    for (const event of events) {
      records.push(await this.append(runId, event.type, event.payload));
    }
    return records;
  }

  async read(runId: string, options: { afterSeq?: number; limit?: number } = {}): Promise<WorkflowEventRecord[]> {
    const file = this.runEventFile(runId);
    if (!existsSync(file)) return [];
    const afterSeq = Number(options.afterSeq || 0);
    const limit = normalizeLimit(options.limit);
    const raw = await readFile(file, 'utf-8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => parseJson(line) as WorkflowEventRecord)
      .filter((event) => event && event.runId === runId && event.seq > afterSeq)
      .slice(0, limit);
  }

  async saveSnapshot(runId: string, snapshot: any, options: { seq?: number; version?: number } = {}): Promise<WorkflowSnapshotRecord> {
    const latestEvents = await this.read(runId, { limit: 1_000_000 }).catch(() => []);
    const record: WorkflowSnapshotRecord = {
      runId,
      seq: Number(options.seq || latestEvents[latestEvents.length - 1]?.seq || 0),
      version: Number(options.version || EVENT_STORE_SCHEMA_VERSION),
      updatedAt: nowIso(),
      snapshot,
    };
    const file = this.runSnapshotFile(runId);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${stableJson(record)}\n`, 'utf-8');
    return record;
  }

  async getSnapshot(runId: string): Promise<WorkflowSnapshotRecord | null> {
    const file = this.runSnapshotFile(runId);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const latest = lines.length > 0 ? parseJson(lines[lines.length - 1]) : null;
    return latest?.runId === runId ? latest as WorkflowSnapshotRecord : null;
  }
}

class SqliteWorkflowEventStore implements WorkflowEventStore {
  private db: SqliteDatabase;

  constructor() {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    this.db = openSqliteDatabase(DB_PATH);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS workflow_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(type);
      CREATE TABLE IF NOT EXISTS workflow_snapshots (
        run_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
    `);
  }

  async append(runId: string, type: string, payload: any): Promise<WorkflowEventRecord> {
    const timestamp = nowIso();
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM workflow_events WHERE run_id = ?').get(runId);
    const seq = Number(row?.seq || 1);
    this.db
      .prepare('INSERT INTO workflow_events (run_id, seq, type, timestamp, payload_json) VALUES (?, ?, ?, ?, ?)')
      .run(runId, seq, type, timestamp, stableJson(payload));
    return { runId, seq, type, timestamp, payload };
  }

  async appendBatch(runId: string, events: Array<{ type: string; payload: any }>): Promise<WorkflowEventRecord[]> {
    const tx = (items: Array<{ type: string; payload: any }>) => withImmediateTransaction(this.db, () => {
      const records: WorkflowEventRecord[] = [];
      const seqRow = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM workflow_events WHERE run_id = ?').get(runId);
      let seq = Number(seqRow?.seq || 1);
      const insert = this.db.prepare('INSERT INTO workflow_events (run_id, seq, type, timestamp, payload_json) VALUES (?, ?, ?, ?, ?)');
      for (const item of items) {
        const timestamp = nowIso();
        insert.run(runId, seq, item.type, timestamp, stableJson(item.payload));
        records.push({ runId, seq, type: item.type, timestamp, payload: item.payload });
        seq += 1;
      }
      return records;
    });
    return tx(events);
  }

  async read(runId: string, options: { afterSeq?: number; limit?: number } = {}): Promise<WorkflowEventRecord[]> {
    const afterSeq = Number(options.afterSeq || 0);
    const limit = normalizeLimit(options.limit);
    const rows = this.db
      .prepare('SELECT run_id, seq, type, timestamp, payload_json FROM workflow_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
      .all(runId, afterSeq, limit);
    return rows.map((row: any) => ({
      runId: row.run_id,
      seq: Number(row.seq),
      type: row.type,
      timestamp: row.timestamp,
      payload: parseJson(row.payload_json),
    }));
  }

  async saveSnapshot(runId: string, snapshot: any, options: { seq?: number; version?: number } = {}): Promise<WorkflowSnapshotRecord> {
    const seq = Number(options.seq || this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM workflow_events WHERE run_id = ?').get(runId)?.seq || 0);
    const record: WorkflowSnapshotRecord = {
      runId,
      seq,
      version: Number(options.version || EVENT_STORE_SCHEMA_VERSION),
      updatedAt: nowIso(),
      snapshot,
    };
    this.db
      .prepare(`
        INSERT INTO workflow_snapshots (run_id, seq, version, updated_at, snapshot_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          seq = excluded.seq,
          version = excluded.version,
          updated_at = excluded.updated_at,
          snapshot_json = excluded.snapshot_json
      `)
      .run(runId, record.seq, record.version, record.updatedAt, stableJson(snapshot));
    return record;
  }

  async getSnapshot(runId: string): Promise<WorkflowSnapshotRecord | null> {
    const row = this.db
      .prepare('SELECT run_id, seq, version, updated_at, snapshot_json FROM workflow_snapshots WHERE run_id = ?')
      .get(runId);
    if (!row) return null;
    return {
      runId: row.run_id,
      seq: Number(row.seq),
      version: Number(row.version),
      updatedAt: row.updated_at,
      snapshot: parseJson(row.snapshot_json),
    };
  }

  close(): void {
    this.db.close();
  }
}

let eventStore: ClosableWorkflowEventStore | null = null;

export function getWorkflowEventStore(): WorkflowEventStore {
  if (eventStore) return eventStore;
  if (process.env.ACE_WORKFLOW_EVENT_STORE === 'jsonl') {
    eventStore = new JsonlWorkflowEventStore();
    return eventStore;
  }
  try {
    eventStore = new SqliteWorkflowEventStore();
  } catch {
    eventStore = new JsonlWorkflowEventStore();
  }
  return eventStore;
}

export function resetWorkflowEventStoreForTests(): void {
  eventStore?.close?.();
  eventStore = null;
}
