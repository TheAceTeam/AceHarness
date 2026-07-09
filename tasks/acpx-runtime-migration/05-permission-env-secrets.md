# Task 5: Permission, Env, And Secret Profiles

Progress: 45%
Status: In Progress

## Goal

Implement unrestricted-by-default permission policy, env profiles, secret profiles, readiness checks, redaction, and audit events.

## Current State

- Existing env API exists, but the new profile/secret schema and runtime snapshot contract do not.
- The user explicitly chose maximum default permissions.
- Spec requires secret values never enter logs, ordinary DTOs, React Query cache, or TanStack DB.

## Follow-Up Work

- Implement permission policy service with `unrestricted`, `approve-reads`, `ask`, `deny-destructive`, and `deny-all`.
- Implement env/secret profile schema, encryption key checks, readiness checks, and conflict detection.
- Implement redaction utilities for prompts, tool IO, raw events, bindings, permission raw payloads, commands, diffs, stderr, and diagnostic bundles.
- Add audit events for every permission request and auto approval.

## Acceptance

- Default policy is `unrestricted`.
- `unrestricted` auto-approves read, write, delete, shell, network, MCP, outside-workspace paths, and destructive commands.
- Permission auto approvals still write runtime events and traces.
- Secret values are absent from ordinary API responses, logs, diagnostics by default, Query cache, and TanStack DB rows.

## Verification Record

- Assigned to subagent for permission/redaction/env-secret skeleton; result pending.
- `npx vitest run tests/runtime-security-profiles.test.ts tests/runtime-contracts.test.ts`: pass.
- `npx vitest run tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`: pass, 33 tests.
- `npx tsc --noEmit --pretty false`: fail only on remaining baseline gaps in `WorkbenchClient.tsx` and `src/start.ts`.
