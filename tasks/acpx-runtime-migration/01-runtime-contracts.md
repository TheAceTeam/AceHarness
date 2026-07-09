# Task 1: Runtime Contracts And Package Boundary

Progress: 100%
Status: Done

## Goal

Create the new runtime type and module boundary so later tasks can depend on stable contracts without importing old engine wrappers.

## Current State

- `ACPX_ENGINE_MIGRATION_SPEC.md` defines `RuntimeOrchestrator`, `RuntimeAdapter`, canonical runtime events, sessions, turns, profiles, and adapter optional methods.
- `src/lib/engines/engine-interface.ts` is the old contract and must not be reused as the new runtime contract.
- No `src/lib/runtime-agent` or equivalent package boundary has been created for this migration.

## Follow-Up Work

- Create a new runtime module namespace for shared contracts, for example `src/lib/runtime-agent`.
- Define runtime ids, session/turn/event/trace types, adapter types, profile snapshots, usage/cost types, and error DTOs.
- Define explicit redaction and external-id DTO boundaries.
- Add lint/static scan target to ensure new runtime core does not import `src/lib/engines`.

## Acceptance

- New contracts compile without importing old engine files.
- Runtime event type includes `traceId`, `seq`, `correlationId`, `parentEventId`, `messageId`, `toolCallId`, `payload`, `redacted`, and `createdAt`.
- Adapter contract includes optional command, compact, fork, and handoff methods.
- A static scan can distinguish allowed migration references from forbidden runtime imports.

## Verification Record

- `npm install`: pass. Dependencies installed before implementation dispatch.
- Assigned to subagent Pauli for implementation; result pending.
- `npx vitest run tests/runtime-contracts.test.ts`: pass.
- `npx vitest run tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`: pass, 17 tests.
- `npx tsc --noEmit --pretty false`: fail only on existing/non-Task-1 errors in `WorkbenchClient.tsx` and `src/start.ts`.
