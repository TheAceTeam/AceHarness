# Memory V2 Design Locks

Updated: 2026-07-24

## Terms And Boundaries

- `Memory item` is the first-level structured, queryable index record with a summary, read condition, scope bindings, lifecycle, optional handoff contract, source, and audit trail.
- `Memory detail` is the one-to-one second-level SQLite record containing a memory item's concrete `details`; it is never joined into a default manifest query.
- `Scope` answers where a memory is relevant: `agent`, `workflow`, `project`, `session`, `run`, or `channel`.
- `Retention` answers whether a candidate is discarded, short-term, or long-term: `none`, `short`, or `long`. Scope and retention are independent, subject to the lifecycle boundary rules below.
- `Short memory` serves only the current conversation or one complete workflow run. It has exactly one immutable lifecycle anchor: conversation short memory anchors to `session`; workflow short memory anchors to `run + workflow`, remains active for the entire run, and exits normal retrieval when that run ends. Additional scope bindings never widen a short record beyond its anchor.
- `Workflow short memory` is cross-Agent: all authorized workflow participants may consume it during the same run. The creating Agent is provenance, not a visibility boundary.
- `Long memory` is durable across conversations or tasks. It must bind to `agent`, `workflow`, or `project`; it does not expire merely because its source session or run ends.
- `Handoff` answers whether and how later workflow steps receive a memory: `none`, `manifest`, `on-demand`, or `required-read`, with an explicit target selector.
- `Manifest` is the bounded prompt payload containing only memory IDs, summaries, read conditions, handoff state, and lightweight provenance.
- `Detail` is the non-default payload returned only by an explicit memory read operation.
- `Artifact` is a raw run output, log, diff, or generated file. It is evidence, not default memory prompt text.

## Current Facts

- `src/lib/workflow/memory-store.ts` stores `role/project/workflow/chat` rows in the existing `memory.sqlite`, caps a bucket at 60 entries, and retrieves records by creation/update time. That file is legacy data and is not the V2 database.
- `src/lib/agent/memory-resolver.ts` injects full memory text only for Agent Chat when `agentMemory.runtimeEnabled` is true.
- `src/lib/state-machine/workflow-manager.ts` persists final review memories and YAML experiences, but its normal step context only reads the last two prior states' output tails.
- Normal serial steps in a single state do not automatically receive the previous serial step output when the runtime Agent changes.
- `channelOutputsById` is an in-memory Map; persist and restore paths do not serialize or rebuild it.
- The active lightweight tasklist and state-machine runtimes use the V2 handoff contract; raw output tails are not the workflow context contract.

## SQLite Contract

The authoritative V2 store is a new workspace `memory-v2.sqlite` file, initialized empty. The existing `memory.sqlite` is archived legacy data and must never be attached, read, or upgraded by the V2 Memory Service. The core schema is:

| table | purpose | required fields |
|---|---|---|
| `memory_items` | First-level index record | `id`, `retention`, `kind`, immutable `lifecycle_anchor_type/key/workflow_id`, `summary`, `read_when`, `read_when_json`, `handoff_mode`, `handoff_target_json`, `index_chars`, `detail_version`, `status`, `confidence`, source fields, timestamps, `expires_at` |
| `memory_details` | Second-level one-to-one detail record | `memory_id`, `detail_version`, `details`, `detail_chars`, `content_hash`, `format`, timestamps |
| `memory_scope_bindings` | Anchor/relevance bindings | `memory_id`, `scope_type`, `scope_key`, `binding_role`, server-derived owner/workspace, `visibility` |
| `memory_links` | Memory lifecycle graph | `from_memory_id`, `to_memory_id`, `relation` |
| `memory_fts` | SQLite FTS5 bounded search projection | `memory_id`, `summary`, `read_when`, bounded `search_projection` without raw detail body |
| `memory_audit` | AI proposal and server decision trail | `id`, nullable `memory_id`, `action`, `actor`, `source_event_id`, `decision_json`, `reason`, `created_at` |
| `run_participants` | Persisted authorization snapshot | `run_id`, `agent_id`, server-derived owner/workspace, membership version, granted/revoked timestamps |
| `run_channel_members` | Persisted channel authorization snapshot | `run_id`, `channel_id`, `agent_id`, membership version, granted/revoked timestamps |
| `memory_handoff_batches` | Per-step handoff outcome | `id`, `run_id`, `source_step_attempt_id`, `source_event_id`, `status`, parent-run provenance, timestamps |
| `memory_handoffs` | One memory delivery instruction | `id`, `batch_id`, `memory_id`, `detail_version`, mode, target selector/resolved targets, status |
| `memory_handoff_receipts` | Target read/acknowledgement state | `handoff_id`, `target_step_attempt_id`, `target_agent_id`, `detail_version`, `extract_hash`, status, failure code, timestamps |
| `memory_artifact_refs` | Typed evidence references | `memory_id`, `detail_version`, `run_id`, artifact kind, validated relative path, content hash, timestamps |
| `legacy_archive_registry` | Metadata-only legacy archive inventory | source path/type, content hash, archived timestamp, retention policy, zero-access verification status |

The logical memory record stores the three mandatory product fields in the two-level schema as follows:

- `summary`: short enough to be injected into a manifest.
- `read_when`: human-readable condition explaining when an AI should consider the memory.
- `details`: concrete facts, decisions, issue detail, verification state, and artifact references in `memory_details`; never injected by default.

`read_when_json` must use an allowlisted structure such as `triggers`, `workflowStates`, `stepIds`, `stepTags`, `agentIds`, and `keywords`. It must not execute arbitrary code or encode unbounded prompt templates.

The full decision shape and validation matrix are authoritative in [memory-decision-and-handoff-protocol.md](memory-decision-and-handoff-protocol.md). Storage duration, scope, handoff delivery, and read conditions are independent AI proposals validated by the server; none may be inferred from a business issue label.

All Memory V2 scopes and tiers use this SQLite index/detail split. There is no parallel YAML, process-memory, or prompt-text memory body after cutover; raw artifacts remain evidence rather than memories. `channel` is an explicit run-scoped type, not a free-text suffix.

## Retrieval Rules

- Query precedence is exact handoff target match, then `run`/`session`, `workflow`, `project`, and `agent` relevance.
- Filter short records by exact lifecycle anchor before any relevance match; then filter server-derived owner/workspace, active participant/channel membership, visibility, retention/lifecycle status, expiry, handoff target, and `read_when_json`. For long records, owner/workspace and visibility remain mandatory and durable relevance bindings determine eligibility. Different Agents in the same authorized run must query the same run-wide short-memory source.
- Rank by target specificity, read-condition match, confidence, task/FTS match, and recency. A domain-specific issue label must not change generic retrieval behavior.
- A manifest has server-enforced per-index and total serialized-character budgets. It contains only matching `manifest` or `required-read` index fields: summaries, read conditions, delivery state, stable memory IDs, and provenance.
- Build the manifest from first-level index rows only. `on-demand` details never appear in a normal manifest; `memory.search` also returns only budgeted index rows. All details require a bounded `memory.read`; `required-read` additionally records that the target step completed the read.
- Ordinary index overflow omits lowest-ranked complete index rows and returns a bounded omission count. A `required-read` index overflow is a preflight failure, never a silent omission.
- A resolved, superseded, expired, unauthorized, anchor-mismatched, or stale-version item cannot appear in a normal active manifest.

## AI Write Rules

- AI calls `memory.propose` with action `discard`, `create`, `upsert`, or `resolve`; it never writes arbitrary SQL or chooses another user's owner, workspace, participant membership, or visibility list.
- A write proposal includes retention, scope bindings, kind, summary, read condition, handoff mode/target, details, confidence, source event, and optional expiry.
- On acceptance, the Memory Service validates the index character limits and writes the index row, one-to-one detail row, bindings, FTS projection, handoff index, and audit row in one transaction. The write response returns IDs/statuses, not echoed details.
- The server validates schema, lifecycle anchor, scope ownership, participant/channel snapshot, duplicate/update keys, expected detail revision/fingerprint, sensitive content, source provenance, and lifecycle transition before committing.
- `manual`, `review`, and `auto` become effective governance modes. They govern the server commit after AI classification; they do not change the AI's ability to classify a candidate.
- Short memory may be auto-written in `review` mode. Long memory remains pending review unless the product policy explicitly permits automatic approval; a short record must never become long solely because time passes.
- Creates use `sourceEventId + idempotencyKey`; upserts/resolves use a stable fingerprint or explicit prior memory ID plus expected detail revision. Superseded records must link to their replacement rather than being overwritten blindly.

## Handoff Rules

- Every completed workflow step emits a persisted `memory_handoff_batch` with structured result or explicit no-op; retries, cancellations, failures, and child-to-parent returns create explicit state transitions rather than overwriting the prior attempt.
- A non-empty handoff writes `memory_handoffs` plus memory IDs and selected index fields only. Individual records keep their independently chosen short/long retention; details remain exclusively in `memory_details` until explicit read.
- The next serial step, including a different Agent in the same state, receives only matching `manifest` summaries from the whole run. A `required-read` target must read a fixed, versioned extract and create a `memory_handoff_receipt` before work continues.
- A required detail denial, timeout, unavailable artifact, stale revision, or unread final page enters `handoff-blocked`; the run must retry, escalate to Supervisor/manual handling, reclassify, or fail the step. It must never silently continue.
- Channel messages are represented by short-term `run + channel` scope bindings validated against `run_channel_members`, not a process-local Map.
- A resumed run queries SQLite handoff batches, deliveries, receipts, participant snapshots, and channels to reconstruct active context. It must not require a memory-resident manager instance.
- Lightweight tasklist and state-machine workflows use the same handoff writer and manifest reader. Raw output files remain fallback evidence only.

## Fresh-Start Cutover

- Add versioned SQLite schema migrations and feature flags before enabling V2, but initialize `memory-v2.sqlite` with no imported memory items, details, handoffs, or relationship records.
- Do not import existing `memory_entries`, editable role memory, chat/project/workflow memory, `experience-library/*.yaml`, `agent-relationships/*.yaml`, channel output, or historical run output. They do not generate V2 summaries, FTS projections, or fallback results.
- Create a checksum-backed, metadata-only `legacy_archive_registry` for old source path/type/hash/retention state. Archive locations are application-read-only: `MemoryService` cannot attach the old SQLite file, read archive bodies, or resolve an archive path through its artifact/detail APIs. Keep old memory stores physically untouched and outside V2 query paths until a separately authorized archival/deletion project. Existing agent relationship behavior is outside Memory V2 and must not be silently reclassified as new memory.
- Disable all legacy memory readers and writers before recording archive hashes. First enablement may create empty `memory-v2.sqlite` only when it does not already exist; later disable/re-enable reuses its V2 data. Automatic overwrite, reset, or deletion of `memory-v2.sqlite` requires a separately authorized destructive operation.
- Keep `workflow-start-contexts.json` as configuration, not AI memory. It may move storage later, but it must not be autonomously rewritten by Agents.
- Keep new raw `runs/{runId}/outputs` files as artifacts and store typed, path-validated references in `memory_artifact_refs`. Do not duplicate arbitrary raw output into `details`.
- Feature rollback disables V2 reads/writes without re-enabling old memory as fallback. It preserves new V2 SQLite data for later re-enable; no dual write, shadow read, import parity, or compatibility outbox is part of this release.

## Do Not Add

- Do not inject all memory details, full transcripts, or raw step output tails into every prompt.
- Do not place full `details` in `memory_items`, FTS projections, manifests, search results, handoff messages, or generated summaries.
- Do not let relevance bindings, a source Agent, a free-text channel name, or a current runtime session bypass a short record's lifecycle anchor or server-derived participant authorization.
- Do not use free-text scope names, unbounded details reads, or client-side memory as the source of truth.
- Do not couple short-memory continuity to provider/runtime session IDs alone.
- Do not expose direct memory editing or clearing in the Agent management page. Retire its legacy UI/API without importing its old memory into V2.
- Do not treat Agent relationship scores or user startup defaults as generic text memories.
- Do not import, fall back to, or silently delete legacy memory data as part of Memory V2 cutover.

## Documentation Rules

- Use `memoryId`, `scopeType`, `scopeKey`, `retention`, `readWhen`, `details`, `handoff`, and `artifactRef` consistently.
- Tests must prove both positive retrieval and negative non-retrieval, especially for anchor-mismatched short memory, on-demand records, expired short memory, cross-project/cross-user data, participant/channel denial, detail-version conflicts, and handoff receipt failure states.
