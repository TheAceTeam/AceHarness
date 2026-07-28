# Task 8: Runtime API Routes And Streaming

Progress: 100%
Status: Done

## Goal

Expose runtime, agents, sessions, events, traces, models, env, and secrets APIs using the new runtime contracts.

## Current State

- Existing routes include `/api/engine`, `/api/agents`, `/api/models`, `/api/chat`, and runtime SQLite utility routes.
- Spec requires new `/api/runtime/*`, `/api/agents/*`, and `/api/runtime-sessions/*` semantics.
- `/api/runtime-sessions/*` routes now exist for session create/get, turn create, events, turn cancel, session cancel, compact, fork, traces, and diagnostics.
- `src/server/runtime/runtime-sessions-api-service.ts` now exposes a SQLite-backed default service that opens the runtime database, creates a `RuntimeSqliteStore`, wires `createRuntimeOrchestrator`, returns full session rows, creates turns, starts non-stream background execution, reads events/traces/diagnostics, and delegates cancellation/compact/fork.
- Route tests exist in `tests/api-runtime-sessions-route.test.ts` for injected service behavior, cursor precedence, limit bounds, SSE ids, payload sanitizing, cancel forwarding, idempotent non-stream execution, compact/fork/traces/diagnostics, SQLite-backed service behavior, redacted trace reads, diagnostics redaction, and owner/admin authorization.

## Follow-Up Work

- SSE/NDJSON streaming now has route-level proof for event seq writes, terminal event flush then close, heartbeat/keepalive while waiting, and structured `turn.failed` runtime error events when stream iteration fails.
- Backpressure behavior remains limited to platform `ReadableStream` semantics; no custom queuing/backpressure adapter was added in Task 8.
- Replace adapter-skeleton terminal failure behavior with real `AcpxRuntime` execution once Task 6 lands.
- Keep structured error DTO and HTTP status tests current as real service wiring lands.
- Keep `/api/engine` only as temporary migration/oldArchitecture endpoint until Task 11.

## Acceptance

- `POST /runtime-sessions/:id/turns` is idempotent by `requestId`.
- `GET /events` supports cursor, `afterSeq`, and bounded `limit`.
- SSE ids use event `seq`; stream closes after terminal event flush.
- Traces are diagnostics-only and redacted by default.

## Verification Record

- `npx vitest run tests/api-runtime-sessions-route.test.ts`: pass, 10 tests.
- `npx vitest run tests/api-runtime-sessions-route.test.ts`: pass, 11 tests after owner/admin authorization coverage.
- `npx vitest run tests/api-runtime-sessions-route.test.ts`: pass, 13 tests after diagnostics bundle and redaction coverage.
- `npx vitest run tests/api-runtime-sessions-route.test.ts tests/runtime-orchestrator.test.ts tests/runtime-sqlite-schema.test.ts tests/model-routes-sqlite.test.ts tests/agent-registry.test.ts`: pass, 5 files / 29 tests.
- `npx tsc --noEmit --pretty false`: pass.
- `npx vitest run tests/api-runtime-sessions-route.test.ts`: pass, 16 tests after SSE/NDJSON terminal flush, keepalive, and structured stream error coverage.
- `npx tsc --noEmit --pretty false`: pass.
