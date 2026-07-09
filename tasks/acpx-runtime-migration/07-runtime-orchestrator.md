# Task 7: Runtime Orchestrator, Queue, And Session Graph

Progress: 10%
Status: In Progress

## Goal

Implement `RuntimeOrchestrator` as the only business entrypoint for sessions, turns, queueing, cancellation, compact, fork, and session graph operations.

## Current State

- Spec defines orchestrator responsibilities and saga/two-phase compact/fork.
- Store and adapter tasks must land first.
- Current Chat/Agent/Workflow flows still call old engine services.

## Follow-Up Work

- Implement open session, run turn, cancel turn, get status, compact, and fork.
- Implement interrupt policies `queue`, `cancel-and-send`, and `reject`.
- Implement compact/fork operation saga with pending/finalizing/completed/failed/compensation states.
- Implement projection updates for chat, workflow, and process blocks.
- Add tests for queue ordering, cancel races, saga failure, and projection rebuild.

## Acceptance

- Business callers can use orchestrator without knowing adapter/provider native ids.
- Browser disconnect does not cancel running turns.
- `cancel-and-send` forks on cancel failure rather than contaminating original session.
- Compact/fork writes session graph edges and traces.

## Verification Record

- Assigned to subagent for orchestrator skeleton; result pending.
