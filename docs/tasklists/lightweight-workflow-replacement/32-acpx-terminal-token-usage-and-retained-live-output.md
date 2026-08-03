# Task 32: ACPX Terminal Token Usage And Retained Live Output

Status: Done

## Execution Contract

- Depends on: Task 31 full-gate regression repair and current ACPX persisted session evidence.
- Unlocks: accurate workflow accounting for ACPX terminal failure, timeout, and cancellation runs.
- Execution: Focused corrective slice; no WorkbenchClient, README, implementation-order, backend token, or unrelated task-doc edits.
- Delegated owner: Child Agent.
- Scope boundary: only `src/lib/runtime-agent/adapters/acpx-runtime-client.ts`, `src/lib/workflow/runtime-facade.ts`, `src/lib/state-machine/workflow-manager.ts`, and focused runtime/workflow tests.

## Goal

Retain actual observed ACPX token usage for cancelled and failed workflow steps without estimating usage or assuming a Codex-only ACPX record shape.

## Root Cause

- ACPX terminal failure events did not carry usage, so downstream runtime projection treated failed turns as missing usage.
- Workflow cancellation requested cancellation and then stopped consuming the turn stream, so terminal cancellation events could be skipped before usage arrived.
- Workflow manager accumulated usage only after successful result handling; failed and cancelled paths threw before adding observed usage to step logs and agent totals.
- ACPX persisted `request_token_usage` is a map keyed by ACP user-message id, not a direct token object, so direct field reads miss real terminal usage.

## Current State

- ACPX runtime status usage remains the first source when available.
- Persisted ACPX fallback reads `request_token_usage` map entries, supports snake_case and camelCase token fields, and falls back to cumulative usage diff.
- Cumulative cost fallback reads `cumulative_cost` when runtime status cost is unavailable.
- Active turn cancellation no longer closes the ACPX runtime before `runTurn` can emit terminal usage.
- Failed and cancelled workflow step paths retain observed usage in failed step logs, agent totals, and persisted run-state agent aggregation.

## Acceptance

- Failed ACPX turns emit terminal usage recovered from persisted `request_token_usage` map entries.
- Cancelled ACPX turns emit terminal usage recovered from status or persisted cumulative usage without requiring Codex-specific fields.
- Cancellation does not cut off its own terminal usage by closing the active runtime before terminal events are consumed.
- Failed workflow steps persist observed token usage and cost in the failed step log and in agent/run aggregation.
- No token usage is estimated; missing observed data remains zero or missing according to the existing downstream contract.

## Verification Record

- `npx vitest run tests/runtime-adapters.test.ts tests/workflow-runtime-session-startup.test.ts tests/state-machine-workflow-manager.test.ts`: pass, `3 passed`, `182 passed`.
- `npx tsc --noEmit --pretty false`: failed only on existing out-of-scope UI errors in `src/components/workflow/LightweightTaskExecutionGraph.tsx` lines 312 and 336.
