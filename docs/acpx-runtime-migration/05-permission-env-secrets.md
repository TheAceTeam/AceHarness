# Task 5: Permission, Env, And Secret Profiles

Progress: 100%
Status: Done

## Goal

Implement unrestricted-by-default permission policy, env profiles, secret profiles, readiness checks, redaction, and audit events.

## Completed

- The user explicitly chose maximum default permissions.
- Default permission policy is `unrestricted`.
- Permission policy persistence covers `unrestricted`, `approve-reads`, `ask`, `deny-destructive`, and `deny-all`.
- `unrestricted` auto-approves read, write, delete, shell, network, MCP, outside-workspace, and destructive command requests.
- Permission approvals produce redacted runtime events and traces.
- Env and secret profile persistence covers owner/private/workspace visibility, encryption key readiness, required secret missing checks, misconfigured secret refs, and conflict detection.
- Runtime env resolution returns backend-only `adapterEnv` while snapshots contain only source/readiness metadata.
- Secret values are absent from public DTOs, runtime snapshots, diagnostics/redaction output, and tested TanStack/ordinary DTO-facing shapes.
- `AcpxRuntimeClient` now translates ACEHarness permission policies into acpx runtime mode/approval behavior instead of passing internal policy ids through to `acpx/runtime`.

## Follow-Up Work

- Add HTTP management routes later if Task 10 UI needs direct profile administration. The runtime store/service API is complete for backend use.

## Acceptance

- Default policy is `unrestricted`.
- `unrestricted` auto-approves read, write, delete, shell, network, MCP, outside-workspace paths, and destructive commands.
- Permission auto approvals still write runtime events and traces.
- Secret values are absent from ordinary API responses, logs, diagnostics by default, Query cache, and TanStack DB rows.

## Verification Record

- `npx vitest run tests/runtime-security-profiles.test.ts tests/runtime-contracts.test.ts`: pass.
- `npx vitest run tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`: pass, 33 tests.
- `npx vitest run tests/runtime-adapters.test.ts`: pass, 11 tests, including permission/profile translation into acpx runtime options.
- `npx tsc --noEmit --pretty false`: pass.
- 2026-07-09 Task 5 worker: `npx vitest run tests/runtime-security-profiles.test.ts tests/runtime-adapters.test.ts`: pass, 20 tests.
- 2026-07-09 Task 5 worker: `npx vitest run tests/runtime-sqlite-schema.test.ts`: pass, 10 tests.
- 2026-07-09 Task 5 worker: `npx tsc --noEmit --pretty false`: pass.
