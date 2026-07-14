# Task 7: Runtime Orchestrator, Queue, And Session Graph

Progress: 100%
Status: Done

## Goal

Implement `RuntimeOrchestrator` as the only business entrypoint for sessions, turns, queueing, cancellation, compact, fork, and session graph operations.

## Completed

- `src/lib/runtime-agent/orchestrator.ts` now exports `createRuntimeOrchestrator`.
- The orchestrator can open sessions, persist profile snapshots and bindings, enqueue/claim turns by request id, call adapters, persist adapter events/traces, cancel queued/running turns, preserve running cancel final status as `cancelled`, and write compact/fork operation records.
- Store and adapter skeletons exist, so this task is no longer blocked on Task 2/6 foundations.
- Interrupt policies cover `queue`, `reject`, and `cancel-and-send`, including fork isolation when cancellation fails.
- Compact/fork writes saga operation states, traces, graph edges, failure compensation, and redacted errors.
- Adapter/native errors are redacted in public events and traces.
- Projection update/rebuild hooks cover chat, workflow, and process-block projections.
- Browser disconnect is covered as a consumer stop-reading behavior that does not call adapter cancel.
- Focused orchestrator tests cover open session, private binding persistence, run-turn event persistence, request idempotency, queued/running cancellation, queue ordering, cancel races, browser disconnect, compact/fork saga, projection rebuild, native id redaction, and session graph edges.

## Follow-Up Work

- Later adapter work can refine native compact/fork semantics if acpx exposes richer operations, without changing the orchestrator contract.

## Acceptance

- Business callers can use orchestrator without knowing adapter/provider native ids.
- Browser disconnect does not cancel running turns.
- `cancel-and-send` forks on cancel failure rather than contaminating original session.
- Compact/fork writes session graph edges and traces.

## Verification Record

- `npx vitest run tests/runtime-orchestrator.test.ts`: pass, 6 tests.
- `npx vitest run tests/api-runtime-sessions-route.test.ts tests/runtime-orchestrator.test.ts tests/runtime-sqlite-schema.test.ts tests/model-routes-sqlite.test.ts tests/agent-registry.test.ts`: pass, 5 files / 29 tests.
- `npx tsc --noEmit --pretty false`: pass.
- 2026-07-09 Task 7 worker: `npx vitest run tests/runtime-orchestrator.test.ts`: pass, 16 tests. Coverage added for adapter/native error hardening and redaction, cancel-and-send isolation fork on cancel failure, FIFO queued claim/requestId idempotency, compact/fork saga failure compensation, projection update/rebuild hooks, browser disconnect without adapter cancel, and session graph traces.
- 2026-07-09 Task 7 worker: `npx tsc --noEmit --pretty false`: pass.
