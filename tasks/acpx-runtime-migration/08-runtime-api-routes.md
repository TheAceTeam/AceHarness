# Task 8: Runtime API Routes And Streaming

Progress: 10%
Status: In Progress

## Goal

Expose runtime, agents, sessions, events, traces, models, env, and secrets APIs using the new runtime contracts.

## Current State

- Existing routes include `/api/engine`, `/api/agents`, `/api/models`, `/api/chat`, and runtime SQLite utility routes.
- Spec requires new `/api/runtime/*`, `/api/agents/*`, and `/api/runtime-sessions/*` semantics.

## Follow-Up Work

- Add runtime session routes for create, get, turns, cancel, compact, fork, events, traces, and diagnostic bundle.
- Implement SSE/NDJSON streaming, cursor replay, Last-Event-ID recovery, heartbeats, limits, and backpressure behavior.
- Add structured error DTOs and HTTP status behavior.
- Keep `/api/engine` only as temporary migration/legacy endpoint until Task 11.

## Acceptance

- `POST /runtime-sessions/:id/turns` is idempotent by `requestId`.
- `GET /events` supports cursor, `afterSeq`, and bounded `limit`.
- SSE ids use event `seq`; stream closes after terminal event flush.
- Traces are diagnostics-only and redacted by default.

## Verification Record

- Assigned to subagent for runtime API route skeleton; result pending.
