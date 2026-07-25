export const MEMORY_V2_SCHEMA_VERSION = 5;

export const MEMORY_V2_SQLITE_PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
`;

export interface MemoryV2Migration {
  version: number;
  name: string;
  sql: string;
  /** SQLite must disable FK enforcement while this migration rebuilds a referenced table. */
  requiresForeignKeysOff?: boolean;
}

const INITIAL_MEMORY_V2_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_v2_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  retention TEXT NOT NULL,
  kind TEXT NOT NULL,
  lifecycle_anchor_type TEXT,
  lifecycle_anchor_key TEXT,
  lifecycle_anchor_workflow_id TEXT,
  summary TEXT NOT NULL,
  read_when TEXT NOT NULL,
  read_when_json TEXT NOT NULL,
  handoff_mode TEXT NOT NULL,
  handoff_target_json TEXT NOT NULL,
  index_chars INTEGER NOT NULL,
  detail_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  fingerprint TEXT NOT NULL,
  governance_mode TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  source_agent_id TEXT,
  source_session_id TEXT,
  source_run_id TEXT,
  source_workflow_id TEXT,
  source_step_attempt_id TEXT,
  owner_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  expires_at TEXT,
  CHECK(retention IN ('short','long')),
  CHECK(handoff_mode IN ('none','manifest','on-demand','required-read')),
  CHECK(status IN ('pending-review','active','resolved','superseded','expired','rejected')),
  CHECK(governance_mode IN ('manual','review','auto')),
  CHECK(confidence >= 0 AND confidence <= 1),
  CHECK(index_chars >= 0),
  CHECK(detail_version >= 1),
  CHECK(
    (retention = 'short' AND lifecycle_anchor_type = 'session' AND lifecycle_anchor_key IS NOT NULL AND lifecycle_anchor_workflow_id IS NULL)
    OR
    (retention = 'short' AND lifecycle_anchor_type = 'run' AND lifecycle_anchor_key IS NOT NULL AND lifecycle_anchor_workflow_id IS NOT NULL)
    OR
    (retention = 'long' AND lifecycle_anchor_type IS NULL AND lifecycle_anchor_key IS NULL AND lifecycle_anchor_workflow_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_items_source_idempotency
  ON memory_items(source_event_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_memory_items_active_anchor
  ON memory_items(retention, lifecycle_anchor_type, lifecycle_anchor_key, lifecycle_anchor_workflow_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_memory_items_owner_workspace_status
  ON memory_items(owner_user_id, workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_items_fingerprint
  ON memory_items(owner_user_id, workspace_id, fingerprint, status);

CREATE TABLE IF NOT EXISTS memory_details (
  memory_id TEXT NOT NULL,
  detail_version INTEGER NOT NULL,
  details TEXT NOT NULL,
  detail_chars INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  format TEXT NOT NULL,
  required_read_extract TEXT,
  required_read_extract_chars INTEGER,
  required_read_extract_hash TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(memory_id, detail_version),
  FOREIGN KEY(memory_id) REFERENCES memory_items(id) ON DELETE RESTRICT,
  CHECK(detail_version >= 1),
  CHECK(detail_chars >= 0),
  CHECK(is_current IN (0,1)),
  CHECK(
    (required_read_extract IS NULL AND required_read_extract_chars IS NULL AND required_read_extract_hash IS NULL)
    OR
    (required_read_extract IS NOT NULL AND required_read_extract_chars >= 0 AND required_read_extract_hash IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_details_one_current
  ON memory_details(memory_id)
  WHERE is_current = 1;

CREATE TABLE IF NOT EXISTS memory_scope_bindings (
  memory_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  binding_role TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(memory_id, scope_type, scope_key, binding_role),
  FOREIGN KEY(memory_id) REFERENCES memory_items(id) ON DELETE RESTRICT,
  CHECK(scope_type IN ('agent','workflow','project','session','run','channel')),
  CHECK(binding_role IN ('lifecycle-anchor','relevance')),
  CHECK(visibility IN ('private','workspace','workflow-participant','channel-member'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_scope_bindings_one_anchor
  ON memory_scope_bindings(memory_id)
  WHERE binding_role = 'lifecycle-anchor';
CREATE INDEX IF NOT EXISTS idx_memory_scope_bindings_lookup
  ON memory_scope_bindings(scope_type, scope_key, owner_user_id, workspace_id, visibility, memory_id);

CREATE TABLE IF NOT EXISTS memory_links (
  from_memory_id TEXT NOT NULL,
  to_memory_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_memory_id, to_memory_id, relation),
  FOREIGN KEY(from_memory_id) REFERENCES memory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(to_memory_id) REFERENCES memory_items(id) ON DELETE RESTRICT,
  CHECK(from_memory_id <> to_memory_id),
  CHECK(relation IN ('supersedes','derived-from','related-to'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  memory_id UNINDEXED,
  summary,
  read_when,
  search_projection
);

CREATE TABLE IF NOT EXISTS memory_audit (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(memory_id) REFERENCES memory_items(id) ON DELETE RESTRICT,
  CHECK(action IN ('discard','create','upsert','resolve','expire','read','handoff','receipt','archive','approve','reject','supersede','reclassify')),
  UNIQUE(source_event_id, idempotency_key, action)
);
CREATE INDEX IF NOT EXISTS idx_memory_audit_memory_created
  ON memory_audit(memory_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_participants (
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  membership_version INTEGER NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(run_id, agent_id, membership_version),
  CHECK(membership_version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_run_participants_active
  ON run_participants(run_id, agent_id, owner_user_id, workspace_id, revoked_at, membership_version DESC);

CREATE TABLE IF NOT EXISTS run_channel_members (
  run_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  membership_version INTEGER NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY(run_id, channel_id, agent_id, membership_version),
  CHECK(membership_version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_run_channel_members_active
  ON run_channel_members(run_id, channel_id, agent_id, owner_user_id, workspace_id, revoked_at, membership_version DESC);

CREATE TABLE IF NOT EXISTS memory_handoff_batches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_step_attempt_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  parent_run_id TEXT,
  parent_step_attempt_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, source_step_attempt_id),
  CHECK(status IN ('no-op','emitted','failed','cancelled','retrying','superseded'))
);
CREATE INDEX IF NOT EXISTS idx_memory_handoff_batches_run_status
  ON memory_handoff_batches(run_id, status, created_at);

CREATE TABLE IF NOT EXISTS memory_handoffs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  detail_version INTEGER NOT NULL,
  mode TEXT NOT NULL,
  target_selector_json TEXT NOT NULL,
  resolved_targets_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES memory_handoff_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY(memory_id, detail_version) REFERENCES memory_details(memory_id, detail_version) ON DELETE RESTRICT,
  UNIQUE(batch_id, memory_id, detail_version),
  CHECK(mode IN ('manifest','on-demand','required-read')),
  CHECK(status IN ('pending','resolved','cancelled','failed'))
);
CREATE INDEX IF NOT EXISTS idx_memory_handoffs_batch_status
  ON memory_handoffs(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_memory_handoffs_memory_version
  ON memory_handoffs(memory_id, detail_version);

CREATE TABLE IF NOT EXISTS memory_handoff_targets (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL,
  target_step_attempt_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  FOREIGN KEY(handoff_id) REFERENCES memory_handoffs(id) ON DELETE RESTRICT,
  UNIQUE(handoff_id, target_step_attempt_id),
  CHECK(status IN ('pending','resolved','cancelled','failed'))
);
CREATE INDEX IF NOT EXISTS idx_memory_handoff_targets_step
  ON memory_handoff_targets(target_step_attempt_id, target_agent_id, handoff_id);

CREATE TABLE IF NOT EXISTS memory_handoff_receipts (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL,
  target_step_attempt_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  detail_version INTEGER NOT NULL,
  extract_hash TEXT,
  status TEXT NOT NULL,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(handoff_id) REFERENCES memory_handoffs(id) ON DELETE RESTRICT,
  UNIQUE(handoff_id, target_step_attempt_id, detail_version),
  CHECK(status IN ('pending','read','acknowledged','failed','cancelled','retrying'))
);
CREATE INDEX IF NOT EXISTS idx_memory_handoff_receipts_target_status
  ON memory_handoff_receipts(target_step_attempt_id, target_agent_id, status);

CREATE TABLE IF NOT EXISTS memory_artifact_refs (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  detail_version INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(memory_id, detail_version) REFERENCES memory_details(memory_id, detail_version) ON DELETE RESTRICT,
  UNIQUE(memory_id, detail_version, run_id, artifact_kind, relative_path, content_hash),
  CHECK(artifact_kind IN ('run-output','log','diff','generated-file'))
);
CREATE INDEX IF NOT EXISTS idx_memory_artifact_refs_memory_version
  ON memory_artifact_refs(memory_id, detail_version);

CREATE TABLE IF NOT EXISTS legacy_archive_registry (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  source_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  retention_policy TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  access_prohibited INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(source_path, source_type, content_hash),
  CHECK(source_type IN ('sqlite','yaml','json','run-output','other')),
  CHECK(verification_status IN ('verified-no-access','pending-verification')),
  CHECK(access_prohibited = 1)
);

CREATE TRIGGER IF NOT EXISTS memory_items_short_anchor_is_immutable
BEFORE UPDATE OF lifecycle_anchor_type, lifecycle_anchor_key, lifecycle_anchor_workflow_id ON memory_items
WHEN OLD.retention = 'short' AND (
  NEW.lifecycle_anchor_type IS NOT OLD.lifecycle_anchor_type
  OR NEW.lifecycle_anchor_key IS NOT OLD.lifecycle_anchor_key
  OR NEW.lifecycle_anchor_workflow_id IS NOT OLD.lifecycle_anchor_workflow_id
)
BEGIN
  SELECT RAISE(ABORT, 'short memory lifecycle anchor is immutable');
END;

CREATE TRIGGER IF NOT EXISTS memory_items_retention_is_immutable
BEFORE UPDATE OF retention ON memory_items
WHEN NEW.retention IS NOT OLD.retention
BEGIN
  SELECT RAISE(ABORT, 'memory retention is immutable; create a replacement instead');
END;

CREATE TRIGGER IF NOT EXISTS memory_scope_anchor_matches_item
BEFORE INSERT ON memory_scope_bindings
WHEN NEW.binding_role = 'lifecycle-anchor'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM memory_items item
    WHERE item.id = NEW.memory_id
      AND item.retention = 'short'
      AND item.lifecycle_anchor_type = NEW.scope_type
      AND item.lifecycle_anchor_key = NEW.scope_key
  ) THEN RAISE(ABORT, 'lifecycle anchor binding must match memory item') END;
END;
`;

const HANDOFF_INDEX_SNAPSHOT_SCHEMA = `
ALTER TABLE memory_handoffs
  ADD COLUMN index_snapshot_json TEXT NOT NULL DEFAULT '{}';
`;

const SCOPE_HARDENING_SCHEMA = `
CREATE TRIGGER IF NOT EXISTS memory_scope_short_binding_is_narrow
BEFORE INSERT ON memory_scope_bindings
WHEN EXISTS (
  SELECT 1
  FROM memory_items item
  WHERE item.id = NEW.memory_id
    AND (
      (item.retention = 'long' AND NEW.scope_type = 'channel')
      OR (NEW.visibility = 'channel-member' AND NEW.scope_type <> 'channel')
      OR (
        item.retention = 'short'
        AND item.lifecycle_anchor_type = 'session'
        AND (
          (NEW.scope_type = 'session' AND NEW.scope_key <> item.lifecycle_anchor_key)
          OR NEW.scope_type IN ('run', 'channel')
        )
      )
      OR (
        item.retention = 'short'
        AND item.lifecycle_anchor_type = 'run'
        AND (
          (NEW.scope_type = 'run' AND NEW.scope_key <> item.lifecycle_anchor_key)
          OR (NEW.scope_type = 'workflow' AND NEW.scope_key <> item.lifecycle_anchor_workflow_id)
          OR NEW.scope_type = 'session'
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'memory scope binding is incompatible with lifecycle anchor');
END;
`;

const HANDOFF_BATCH_RETRYING_SCHEMA = `
ALTER TABLE memory_handoff_batches RENAME TO memory_handoff_batches_before_retrying;

CREATE TABLE memory_handoff_batches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_step_attempt_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  parent_run_id TEXT,
  parent_step_attempt_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, source_step_attempt_id),
  CHECK(status IN ('no-op','emitted','failed','cancelled','retrying','superseded'))
);

INSERT INTO memory_handoff_batches (
  id, run_id, source_step_attempt_id, source_event_id, status,
  parent_run_id, parent_step_attempt_id, created_at, updated_at
)
SELECT
  id, run_id, source_step_attempt_id, source_event_id, status,
  parent_run_id, parent_step_attempt_id, created_at, updated_at
FROM memory_handoff_batches_before_retrying;

DROP TABLE memory_handoff_batches_before_retrying;

CREATE INDEX IF NOT EXISTS idx_memory_handoff_batches_run_status
  ON memory_handoff_batches(run_id, status, created_at);
`;

const GOVERNANCE_AUDIT_ACTION_SCHEMA = `
DROP INDEX IF EXISTS idx_memory_audit_memory_created;

ALTER TABLE memory_audit RENAME TO memory_audit_before_governance_actions;

CREATE TABLE memory_audit (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(memory_id) REFERENCES memory_items(id) ON DELETE RESTRICT,
  CHECK(action IN ('discard','create','upsert','resolve','expire','read','handoff','receipt','archive','approve','reject','supersede','reclassify')),
  UNIQUE(source_event_id, idempotency_key, action)
);

INSERT INTO memory_audit (
  id, memory_id, action, actor, source_event_id, idempotency_key, decision_json, reason, created_at
)
SELECT
  id, memory_id, action, actor, source_event_id, idempotency_key, decision_json, reason, created_at
FROM memory_audit_before_governance_actions;

DROP TABLE memory_audit_before_governance_actions;

CREATE INDEX IF NOT EXISTS idx_memory_audit_memory_created
  ON memory_audit(memory_id, created_at DESC);
`;

export const MEMORY_V2_MIGRATIONS: readonly MemoryV2Migration[] = [
  {
    version: 1,
    name: 'initial-memory-v2-schema',
    sql: INITIAL_MEMORY_V2_SCHEMA,
  },
  {
    version: 2,
    name: 'handoff-index-snapshot',
    sql: HANDOFF_INDEX_SNAPSHOT_SCHEMA,
  },
  {
    version: 3,
    name: 'scope-binding-lifecycle-hardening',
    sql: SCOPE_HARDENING_SCHEMA,
  },
  {
    version: 4,
    name: 'handoff-batch-retrying',
    sql: HANDOFF_BATCH_RETRYING_SCHEMA,
    requiresForeignKeysOff: true,
  },
  {
    version: 5,
    name: 'governance-audit-actions',
    sql: GOVERNANCE_AUDIT_ACTION_SCHEMA,
  },
];
