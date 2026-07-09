# Task 9: TanStack Client State Layer

Progress: 100%
Status: Done

## Goal

Migrate client cache and local reactive state to runtime-aware TanStack Query keys and TanStack DB collections.

## Current State

- `src/client/query/query-keys.ts` already centralizes query keys.
- `src/client/db/collections.ts` already uses TanStack DB.
- Existing collections and keys still include engine-era concepts.

## Follow-Up Work

- Add runtime session, turn, event, projection, agent runtime state, model route, probe run, and benchmark run collections.
- Add runtime query keys using only platform ids.
- Implement initial snapshot fetch plus SSE/NDJSON incremental upsert.
- Batch high-frequency delta events with `requestAnimationFrame` or 50-100ms batching.
- Ensure secret values and provider native ids never enter client caches.

## Acceptance

- Runtime client state uses `runtimeSessionId`, `turnId`, `modelRouteId`, `probeId`, and `projectionVersion`.
- `runtime_bindings.*`, provider/acpx ids, raw auth ids, and secret values are absent from Query keys and TanStack DB rows.
- Streaming upserts are idempotent by `sessionId + seq`.
- Trace/probe/benchmark long lists use pagination and virtualized rendering where appropriate.

## Verification Record

- Assigned to subagent for query key and TanStack DB collection skeleton; result pending.
- `npm test -- tests/runtime-client-state.test.ts`: pass.
- `npx vitest run tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`: pass, 33 tests.
- `npx tsc --noEmit --pretty false`: fail only on remaining baseline gaps in `WorkbenchClient.tsx` and `src/start.ts`.
- Task 9 closeout: runtime query keys now guard against provider/acpx/native/auth/secret/raw key material.
- Task 9 closeout: runtime TanStack DB rows are normalized through platform-facing allow-lists before upsert.
- Task 9 closeout: added initial snapshot fetch/sync helper plus SSE/NDJSON incremental upsert helper with testable 50-100ms batching fallback.
- Task 9 closeout: `npx vitest run tests/runtime-client-state.test.ts`: pass, 8 tests.
- Task 9 closeout: `npx tsc --noEmit --pretty false`: pass.
- Task 9 route alignment: runtime client paths now target `/api/runtime-sessions/:id`; initial snapshot uses existing session and events routes instead of a non-existent snapshot endpoint.
- Task 9 route alignment: `npx vitest run tests/runtime-client-state.test.ts tests/api-runtime-sessions-route.test.ts`: pass, 24 tests.
- Task 9 route alignment: `npx tsc --noEmit --pretty false`: pass.
