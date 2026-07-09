export const RUNTIME_SCHEMA_VERSION = 1;

export const RUNTIME_SQLITE_PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
`;

export const RUNTIME_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS model_routes (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS env_profiles (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS secret_profiles (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS permission_policies (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS runtime_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model_route_id TEXT,
  owner_user_id TEXT,
  title TEXT,
  status TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(model_route_id) REFERENCES model_routes(id) ON DELETE SET NULL,
  CHECK(kind IN ('chat','agent','workflow-agent','workflow-supervisor','agora','probe','diagnostic')),
  CHECK(status IN ('creating','active','archived','compacted','forking','compacting','invalid','deleted'))
);

CREATE TABLE IF NOT EXISTS runtime_bindings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  runtime TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary',
  generation INTEGER NOT NULL DEFAULT 1,
  external_record_id TEXT,
  external_session_id TEXT,
  provider_session_id TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  CHECK(runtime IN ('acpx','magic')),
  CHECK(role IN ('primary','handoff-source','handoff-target','migration','diagnostic')),
  UNIQUE(session_id, runtime, role, generation)
);

CREATE TABLE IF NOT EXISTS runtime_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  interrupt_policy TEXT NOT NULL,
  input_text TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  cancel_reason TEXT,
  cancel_request_id TEXT,
  error_json TEXT,
  usage_json TEXT,
  cost_json TEXT,
  FOREIGN KEY(session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, request_id),
  UNIQUE(trace_id),
  CHECK(status IN ('queued','running','canceling','cancelled','completed','failed','dropped','expired','invalid')),
  CHECK(interrupt_policy IN ('queue','cancel-and-send','reject'))
);

CREATE TABLE IF NOT EXISTS runtime_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  trace_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  correlation_id TEXT,
  parent_event_id TEXT,
  message_id TEXT,
  tool_call_id TEXT,
  payload_json TEXT NOT NULL,
  redacted INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(turn_id) REFERENCES runtime_turns(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_event_id) REFERENCES runtime_events(id) ON DELETE SET NULL,
  CHECK(redacted IN (0,1)),
  UNIQUE(session_id, seq)
);

CREATE TABLE IF NOT EXISTS runtime_session_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  agent_id TEXT NOT NULL,
  model_route_id TEXT,
  system_prompt_hash TEXT,
  skills_revision TEXT,
  mcp_revision TEXT,
  interrupt_policy TEXT NOT NULL,
  skills_json TEXT NOT NULL,
  mcp_servers_json TEXT NOT NULL,
  env_profile_id TEXT,
  secret_profile_id TEXT,
  permission_policy_id TEXT,
  cwd TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(turn_id) REFERENCES runtime_turns(id) ON DELETE SET NULL,
  FOREIGN KEY(model_route_id) REFERENCES model_routes(id) ON DELETE SET NULL,
  FOREIGN KEY(env_profile_id) REFERENCES env_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY(secret_profile_id) REFERENCES secret_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY(permission_policy_id) REFERENCES permission_policies(id) ON DELETE SET NULL,
  CHECK(interrupt_policy IN ('queue','cancel-and-send','reject'))
);

CREATE TABLE IF NOT EXISTS runtime_session_operations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  target_session_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  compensation_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(target_session_id) REFERENCES runtime_sessions(id) ON DELETE SET NULL,
  CHECK(kind IN ('fork','compact','restore','rollback','summary-handoff')),
  CHECK(status IN ('pending','external-running','finalizing','completed','failed','compensating','compensated'))
);

CREATE TABLE IF NOT EXISTS runtime_session_edges (
  id TEXT PRIMARY KEY,
  operation_id TEXT,
  from_session_id TEXT NOT NULL,
  to_session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  at_turn_id TEXT,
  at_message_id TEXT,
  summary TEXT,
  error_json TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(operation_id) REFERENCES runtime_session_operations(id) ON DELETE SET NULL,
  FOREIGN KEY(from_session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(to_session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  CHECK(from_session_id <> to_session_id),
  CHECK(kind IN ('fork','compact','restore','rollback','summary-handoff')),
  CHECK(status IN ('pending','active','failed')),
  UNIQUE(from_session_id, to_session_id, kind)
);

CREATE TABLE IF NOT EXISTS runtime_traces (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  session_id TEXT,
  turn_id TEXT,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  redacted INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(turn_id) REFERENCES runtime_turns(id) ON DELETE CASCADE,
  CHECK(level IN ('debug','info','warning','error')),
  CHECK(redacted IN (0,1))
);

CREATE TABLE IF NOT EXISTS agent_runtime_state (
  agent_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  hidden INTEGER NOT NULL DEFAULT 0,
  override_json TEXT,
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  availability_checked_at TEXT,
  env_readiness_json TEXT,
  capability_probe_json TEXT,
  discovery_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(enabled IN (0,1)),
  CHECK(hidden IN (0,1)),
  CHECK(availability_status IN ('unknown','available','missing','misconfigured','failed'))
);

CREATE TABLE IF NOT EXISTS runtime_projection_cache (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  projection TEXT NOT NULL,
  version INTEGER NOT NULL,
  last_seq INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
  CHECK(projection IN ('chat','workflow','process-block')),
  UNIQUE(session_id, projection, version)
);

CREATE INDEX IF NOT EXISTS idx_runtime_turns_session_status_queued
  ON runtime_turns(session_id, status, queued_at);
CREATE INDEX IF NOT EXISTS idx_runtime_turns_status_queued_id
  ON runtime_turns(status, queued_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_turns_one_active_per_session
  ON runtime_turns(session_id)
  WHERE status IN ('running','canceling');
CREATE INDEX IF NOT EXISTS idx_runtime_turns_trace_id
  ON runtime_turns(trace_id);
CREATE INDEX IF NOT EXISTS idx_runtime_turns_lease_expires
  ON runtime_turns(status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_runtime_events_session_seq
  ON runtime_events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_runtime_events_turn_seq
  ON runtime_events(turn_id, seq);
CREATE INDEX IF NOT EXISTS idx_runtime_events_trace_seq
  ON runtime_events(trace_id, seq);
CREATE INDEX IF NOT EXISTS idx_runtime_events_correlation
  ON runtime_events(correlation_id);

CREATE INDEX IF NOT EXISTS idx_runtime_traces_trace_created
  ON runtime_traces(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runtime_traces_session_turn_created
  ON runtime_traces(session_id, turn_id, created_at);

CREATE INDEX IF NOT EXISTS idx_runtime_sessions_owner_updated
  ON runtime_sessions(owner_user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_runtime_sessions_kind_status_updated
  ON runtime_sessions(kind, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_runtime_session_operations_session_kind_status_created
  ON runtime_session_operations(session_id, kind, status, created_at);
CREATE INDEX IF NOT EXISTS idx_runtime_session_edges_from_kind
  ON runtime_session_edges(from_session_id, kind);
CREATE INDEX IF NOT EXISTS idx_runtime_session_edges_to_kind
  ON runtime_session_edges(to_session_id, kind);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_state_availability
  ON agent_runtime_state(availability_status, availability_checked_at);
CREATE INDEX IF NOT EXISTS idx_runtime_projection_cache_session_projection_version
  ON runtime_projection_cache(session_id, projection, version);
`;

export function runtimeSqliteBootstrapSql(): string {
  return `${RUNTIME_SQLITE_PRAGMAS}\n${RUNTIME_SQLITE_SCHEMA}`;
}
