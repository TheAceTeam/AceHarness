# Task 2: SQLite Runtime Schema And Stores

Progress: 45%
Status: In Progress

## Goal

Implement SQLite schema and store APIs for runtime sessions, bindings, turns, events, traces, operations, edges, projection cache, and agent runtime state.

## Current State

- `better-sqlite3` is already a dependency.
- The spec requires WAL, foreign keys, busy timeout, `BEGIN IMMEDIATE`, lease fields, partial unique indexes, and projection cache.
- Existing runtime SQLite routes exist under `src/server/api-routes/runtime/sqlite`, but they are generic database tooling, not the new runtime source of truth.

## Follow-Up Work

- Add schema migration files or schema bootstrap for runtime tables.
- Implement store modules for sessions, turns, events, traces, operations, edges, projections, and agent runtime state.
- Implement transaction helpers for turn enqueue, lease claim, event append, completion, cancel, and projection update.
- Add reclaimer logic for expired leases.

## Acceptance

- Schema includes all required foreign keys, checks, partial unique indexes, and read-path indexes from the spec.
- Same session cannot have more than one `running` or `canceling` turn at database level.
- Event append and projection cache update commit or roll back together.
- Unit tests cover enqueue idempotency, lease claim, duplicate running protection, event seq monotonicity, cancel transitions, and expired lease recovery.

## Verification Record

- `npm install`: pass. Dependencies installed before implementation dispatch.
- Assigned to subagent Gauss for implementation; result pending.
- `npx vitest run tests/runtime-sqlite-schema.test.ts`: pass.
- `npx vitest run tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`: pass, 17 tests.
- `npx tsc --noEmit --pretty false`: fail only on existing/non-Task-2 errors in `WorkbenchClient.tsx` and `src/start.ts`.
