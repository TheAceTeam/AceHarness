# Task 2: SQLite Runtime Schema And Stores

Progress: 100%
Status: Done

## Goal

Implement SQLite schema and store APIs for runtime sessions, bindings, turns, events, traces, operations, edges, projection cache, and agent runtime state.

## Completed

- `better-sqlite3` is already a dependency.
- Runtime schema bootstrap covers the runtime source-of-truth tables: sessions, snapshots, bindings, turns, events, traces, operations, edges, projection cache, and agent runtime state.
- Store APIs cover sessions, bindings, turns, events, traces, operations, edges, projection cache, and agent runtime state.
- Tests cover WAL, foreign keys, busy timeout, required tables, key indexes, enqueue idempotency, lease claim, duplicate running protection, event seq monotonicity, cancel transitions, expired lease recovery, explicit lease reclaimer, projection rollback, and core store read/write APIs.

## Follow-Up Work

- Keep `claimNextTurn` expired lease compatibility in mind when Task 7 refines worker scheduling. The explicit `reclaimExpiredLeases` method now exists for stricter orchestration.

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
- 2026-07-09 Task 2 closeout worker: added store read APIs for bindings/traces/operations/edges/projection cache/agent runtime state, explicit `reclaimExpiredLeases`, and projection rollback coverage.
- 2026-07-09 `npx vitest run tests/runtime-sqlite-schema.test.ts`: pass, 10 tests.
- 2026-07-09 `npx tsc --noEmit --pretty false`: pass.
