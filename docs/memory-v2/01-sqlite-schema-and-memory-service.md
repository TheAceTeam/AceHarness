# Task 1: SQLite Schema And Memory Service

Progress: 100%
Status: Done

## Goal

Create the versioned SQLite schema and a single server-side Memory Service that owns persistence, lifecycle, scope filtering, fresh-start initialization, and bounded manifest queries.

## Current State

- The existing `memory.sqlite` only models flat `memory_entries` buckets with recency retrieval; it is a legacy archive source, not the V2 database.
- Workflow experiences and Agent relationships are stored in YAML files outside SQLite; the V2 fresh-start rule intentionally leaves them there rather than importing them.
- Existing writers have no common audit, expiry, source-event idempotency, or scope-binding model.
- Implementation ownership is confirmed as a new isolated `src/lib/memory-v2/` module. The Agent has started the public type contract and will not edit old memory stores, workflow/chat/UI/route code in this task.
- The first implementation Agent was interrupted by an external `503` before formal handoff. Its isolated V2-module edits remain unaccepted; a recovery Agent is reviewing and completing them within the same task boundary.
- Recovery audit found four pre-acceptance contract gaps: short-memory scope proposals could widen a unique session/run anchor; FTS could retain rows after lifecycle transitions; an upsert could lose a handoff's frozen index revision; artifact path/hash and handoff target/receipt validation need hardening. All are assigned to the recovery Agent inside the Task 1 module boundary.
- The candidate now contains isolated V2 types, migrations, connection handling, and a Memory Service. Static inspection confirms explicit index-only manifest/search records, detail reads by revision, short-anchor checks, server-side participant/channel snapshots, persisted handoff rows/receipts, FTS removal on lifecycle transitions, and a frozen handoff index snapshot. It remains subject to Contract Gate A and has no runtime verification evidence.
- Gate A found two blocking repairs: `openMemoryV2Database` still accepts an arbitrary caller-supplied filename rather than explicitly rejecting legacy database/archive paths, and `memory_handoff_batches` has no persisted `retrying` state even though retry is part of the handoff protocol. These must be repaired in Task 1 before downstream dispatch.
- Contract Gate A repairs are complete. The connection factory now accepts only canonical `memory-v2.sqlite` or isolated `:memory:`, rejects legacy/archive/SQLite-URI/ATTACH-style paths and injected databases, and the version 4 migration adds persisted `retrying` handoff-batch state with guarded lifecycle transitions.
- Gate B static review found a bounded retrieval defect: `buildManifest` admits no-delivery records only when their handoff mode is `manifest` and a run participant is present. A normal conversation-short record with a matching session anchor and `handoff: none` is therefore omitted, contrary to the V2 lifecycle contract.
- B-R4 static review accepted the atomic resolved-handoff API and retry-target reissue path. A pristine `retrying` batch can transition to `emitted` only in the same SQLite immediate transaction that validates frozen deliveries and persists handoffs, targets, receipts, snapshots, and audit records.

## Follow-Up Work

- Create a new empty `memory-v2.sqlite` and add schema migrations for `memory_items`, `memory_details`, anchor/relevance `memory_scope_bindings`, `memory_links`, bounded `memory_fts`, `memory_audit`, `run_participants`, `run_channel_members`, `memory_handoff_batches`, `memory_handoffs`, `memory_handoff_receipts`, `memory_artifact_refs`, and metadata-only `legacy_archive_registry`.
- Introduce typed contracts for retention, kind, lifecycle status, read conditions, handoff mode/target, source provenance, owner, and visibility, following [the decision and handoff protocol](memory-decision-and-handoff-protocol.md).
- Make every short record use one immutable lifecycle anchor: a conversation must anchor to exactly one `session`; a workflow item must anchor to exactly one `run + workflow`, plus participant visibility. Relevance bindings may narrow a lookup but must never widen a short record beyond its anchor. Make `long` records require an `agent`, `workflow`, or `project` binding.
- Add schema checks and partial unique indexes enforcing the short anchor shape, one current detail revision per item, one handoff batch per `runId + sourceStepAttemptId`, one resolved delivery per target, and one receipt per `handoffId + targetStepAttemptId + detailVersion`.
- Persist run/channel participant snapshots from server-owned run state and use them, not AI input, to derive read authorization.
- Implement transactional APIs: `propose`, `upsert`, `resolve`, `expire`, `buildManifest`, `readDetails`, `acknowledgeRequiredRead`, `search`, `completeHandoffBatch`, `resolveHandoffTargets`, `recordHandoffReceipt`, and `initializeFreshStore`.
- Add FTS5 projection maintenance for bounded index/search projections and deterministic indexes for active run/session/anchor queries. Do not project raw details into FTS.
- Make first enablement disable all legacy memory readers/writers, create an empty V2 store only if `memory-v2.sqlite` does not already exist, then write a fresh-start marker plus checksum-backed legacy archive metadata. Explicitly reject legacy import endpoints/jobs and assert that legacy stores cannot contribute a candidate, index, detail, FTS projection, prompt, governance view, or fallback response.
- Enforce per-item and per-read size budgets without truncating database source data. Required reads must use versioned, bounded extracts with cursor/page handling for ordinary detail reads.
- Repair the normal manifest-selection branch so authorized session-short and long records with a matching `readWhen` can be selected without inventing a run handoff, while preserving the strict run-target rules for workflow deliveries.
- No implementation follow-up remains inside the Task 1 ownership boundary. Runtime SQLite rollback, concurrency, authorization, migration, and retry behavior remain explicit verification gaps.

## Acceptance

- Schema migration can run repeatedly without changing or importing legacy memory data; first V2 enablement starts with zero V2 memory items and details in `memory-v2.sqlite`.
- Re-enable never overwrites existing V2 data; an explicit reset/delete flow is outside this task and must not be reached by normal feature flags.
- A memory item can bind to multiple scopes while storing one canonical detail payload.
- A conversation short item is active only in its session; a workflow short item is active to the end of its complete run and readable across authorized participating Agents. Neither can become long implicitly; a long item remains available after its source session/run ends.
- A short item cannot match through a project/agent/channel relevance binding when its unique session/run anchor does not match; an unauthorized participant or channel member cannot read either its index or details.
- Active manifest queries exclude expired, resolved, superseded, unauthorized, and nonmatching items.
- Manifest, on-demand, and required-read delivery modes yield different observable results for the same memory item without changing its retention classification.
- Search and direct detail reads return stable IDs and provenance.
- Each step attempt persists a no-op or non-empty handoff batch; retry, child-workflow return, cancellation, and required-read receipt states survive resume without duplicating the original delivery.
- Upsert/resolve rejects a stale `expectedDetailVersion` or nonmatching fingerprint, and direct detail reads use the exact requested revision.
- Artifact links use typed records and path validation.
- Legacy memory tables/files remain physically untouched and provably absent from V2 query plans, manifests, searches, details, and handoff reconstruction.

## Verification Record

- Not run: implementation is assigned. Per user direction, no build or test command will be run during this workstream. The implementing Agent must instead return static contract/schema evidence and all unproven runtime behavior for main-Agent review.
- 2026-07-24: Scope inspection completed by the assigned Agent. Confirmed intended module boundary is `src/lib/memory-v2/`; no runtime verification has been performed.
- 2026-07-24: Initial implementation handoff was interrupted by an external `503`. Existing changes are under recovery review and are not accepted evidence.
- 2026-07-24: Recovery static audit identified anchor-widening, stale-FTS, frozen-handoff-version, and validation gaps. Repairs are in progress; Task 1 remains unaccepted.
- 2026-07-24: Main-Agent static review started. Candidate code is isolated to `src/lib/memory-v2/`; no build, lint, or test command was run per user direction.
- 2026-07-24: Gate A static finding: candidate fails the V2-only connection-path contract and omits the required persisted handoff-batch `retrying` state. Both are assigned as a bounded Task 1 repair; no downstream task may start first.
- 2026-07-24: Contract Gate A accepted after bounded repair. Static inspection confirms V2-only connection handling, no legacy reader/import/attach path, index-only manifest/search shapes, explicit revisioned details, anchor constraints, authorization snapshots, handoff index snapshots/receipts, and retrying migration/lifecycle guards. No build, lint, or test command was run per user direction; runtime proof remains in `verification-gaps.md`.
- 2026-07-25: Gate B static review reopened a bounded Task 1 repair. `buildManifest`'s ordinary no-delivery branch requires `handoff.mode === 'manifest'` plus a run participant, so it excludes ordinary session-short records. No build, lint, or test command was run.
- 2026-07-25: B-R1 static review accepted. Ordinary retrieval now accepts only `handoff: none` records after existing `isReadable` and `readWhen` checks, so matching session-short and long records can enter the manifest without a run handoff. `manifest`/`required-read` remain frozen delivery-only and `on-demand` remains search-only. No build, lint, or test command was run.
- 2026-07-25: B-R4 dispatched after workflow cross-review. Existing APIs cannot make emitted delivery plus target resolution atomic or reissue a required-read target for a retry attempt while preserving the original frozen revision. The repair is restricted to `src/lib/memory-v2/` public types/service; no build, lint, or test command was run.
- 2026-07-25: B-R4 static review accepted. `emitResolvedHandoffBatch` validates server-planned targets, immutable selectors/revisions, participant/channel authorization, and required-read extract hashes before any write, then emits batch/handoff/target/receipt/snapshot/audit rows in one immediate transaction. Existing emitted batches replay only if their frozen deliveries and targets match; an empty retrying batch may transition atomically to emitted. `reissueResolvedHandoffTargetsForRetry` creates only new target-attempt receipts without overwriting old receipts. A sub-agent cross-review found no blocking issue; runtime proof remains open.
