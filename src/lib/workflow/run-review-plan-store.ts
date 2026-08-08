import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import type { RunReviewPlanArtifact } from '@/lib/workflow/run-review-plan';

export const RUN_REVIEW_PLAN_PER_USER_LIMIT = 20;

type StoredRunReviewPlanRow = {
  artifact_json: string;
};

function openStore(): Database.Database {
  // Resolve this on every call so tests and multi-install deployments honour the
  // active ACE_HOME instead of pinning the path at module-import time.
  const filename = getWorkspaceDataFile('run-review-plans.sqlite');
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename, { timeout: 5_000 });
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_review_plans (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      artifact_json TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      saved_at_ms INTEGER NOT NULL,
      PRIMARY KEY (owner_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_run_review_plans_owner_saved
      ON run_review_plans(owner_id, saved_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_run_review_plans_expiry
      ON run_review_plans(expires_at_ms);
  `);
  return db;
}

function withStore<T>(fn: (db: Database.Database) => T): T {
  const db = openStore();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function withImmediateTransaction<T>(db: Database.Database, fn: () => T): T {
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

function pruneExpiredPlans(db: Database.Database): void {
  db.prepare('DELETE FROM run_review_plans WHERE expires_at_ms <= ?').run(Date.now());
}

function parseArtifact(
  db: Database.Database,
  ownerId: string,
  id: string,
  row: StoredRunReviewPlanRow | undefined,
): RunReviewPlanArtifact | null {
  if (!row) return null;
  try {
    return JSON.parse(row.artifact_json) as RunReviewPlanArtifact;
  } catch {
    db.prepare('DELETE FROM run_review_plans WHERE owner_id = ? AND id = ?').run(ownerId, id);
    return null;
  }
}

function expiresAtMs(artifact: RunReviewPlanArtifact): number {
  const value = Date.parse(artifact.plan.expiresAt);
  if (!Number.isFinite(value)) throw new Error('本次运行方案缺少有效的过期时间');
  return value;
}

export function saveRunReviewPlanArtifact(ownerId: string, artifact: RunReviewPlanArtifact): void {
  withStore((db) => withImmediateTransaction(db, () => {
    pruneExpiredPlans(db);
    const savedAt = Date.now();
    db.prepare(`
      INSERT INTO run_review_plans (owner_id, id, artifact_json, expires_at_ms, saved_at_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, id) DO UPDATE SET
        artifact_json = excluded.artifact_json,
        expires_at_ms = excluded.expires_at_ms,
        saved_at_ms = excluded.saved_at_ms
    `).run(ownerId, artifact.plan.id, JSON.stringify(artifact), expiresAtMs(artifact), savedAt);

    // Always retain the plan just saved, plus the newest remaining plans for
    // this owner. Other users are deliberately outside this quota.
    const stale = db.prepare(`
      SELECT id
      FROM run_review_plans
      WHERE owner_id = ? AND id <> ?
      ORDER BY saved_at_ms DESC, rowid DESC
      LIMIT -1 OFFSET ?
    `).all(ownerId, artifact.plan.id, RUN_REVIEW_PLAN_PER_USER_LIMIT - 1) as Array<{ id: string }>;
    const remove = db.prepare('DELETE FROM run_review_plans WHERE owner_id = ? AND id = ?');
    for (const row of stale) remove.run(ownerId, row.id);
  }));
}

export function loadRunReviewPlanArtifact(ownerId: string, id: string): RunReviewPlanArtifact | null {
  return withStore((db) => {
    pruneExpiredPlans(db);
    const row = db.prepare(`
      SELECT artifact_json
      FROM run_review_plans
      WHERE owner_id = ? AND id = ?
    `).get(ownerId, id) as StoredRunReviewPlanRow | undefined;
    return parseArtifact(db, ownerId, id, row);
  });
}

export function replaceRunReviewPlanArtifact(ownerId: string, artifact: RunReviewPlanArtifact): void {
  withStore((db) => withImmediateTransaction(db, () => {
    pruneExpiredPlans(db);
    const result = db.prepare(`
      UPDATE run_review_plans
      SET artifact_json = ?, expires_at_ms = ?, saved_at_ms = ?
      WHERE owner_id = ? AND id = ?
    `).run(JSON.stringify(artifact), expiresAtMs(artifact), Date.now(), ownerId, artifact.plan.id);
    if (result.changes === 0) throw new Error('找不到本次运行方案');
  }));
}

export function consumeRunReviewPlanArtifact(ownerId: string, id: string): RunReviewPlanArtifact | null {
  return withStore((db) => withImmediateTransaction(db, () => {
    pruneExpiredPlans(db);
    const row = db.prepare(`
      SELECT artifact_json
      FROM run_review_plans
      WHERE owner_id = ? AND id = ?
    `).get(ownerId, id) as StoredRunReviewPlanRow | undefined;
    const artifact = parseArtifact(db, ownerId, id, row);
    if (artifact) db.prepare('DELETE FROM run_review_plans WHERE owner_id = ? AND id = ?').run(ownerId, id);
    return artifact;
  }));
}

export function discardRunReviewPlanArtifact(ownerId: string, id: string): boolean {
  return withStore((db) => {
    pruneExpiredPlans(db);
    return db.prepare('DELETE FROM run_review_plans WHERE owner_id = ? AND id = ?').run(ownerId, id).changes > 0;
  });
}
