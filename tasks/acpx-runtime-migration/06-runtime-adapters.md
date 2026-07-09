# Task 6: Runtime Adapters For acpx And Magic

Progress: 70%
Status: In Progress

## Goal

Implement `AcpxAdapter` for all acpx-supported non-Magic agents and `MagicAdapter` for `cangjie-magic`.

## Current State

- Spec says acpx is the main adapter and Magic implements the same ACEHarness adapter contract.
- Current code still has separate SDK and wrapper implementations in `src/lib/engines`.
- acpx package integration details must be verified against installed dependency/API before implementation.

## Follow-Up Work

- Add or verify acpx dependency and inspect available exports.
- Implement `AcpxAdapter` event normalization to canonical adapter events.
- Implement custom agent command mapping for NGA and CodeGenie.
- Implement `MagicAdapter` using Cangjie Magic runtime facilities without imitating acpx API directly.
- Implement usage/cost normalization with `missing` versus zero semantics.
- Add adapter tests with fake acpx/Magic processes or mocks.

## Acceptance

- Non-Magic core/verified agents route through `AcpxAdapter`.
- `cangjie-magic` routes through `MagicAdapter`.
- No new SDK driver branch is added.
- Adapter events normalize into canonical runtime events and hide provider ids from ordinary DTOs.

## Verification Record

- Assigned to subagent for acpx package/API inspection and adapter skeleton; result pending.
- `npx vitest run tests/runtime-adapters.test.ts`: pass.
- `npx vitest run tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-adapters.test.ts`: pass, 40 tests.
- `npx tsc --noEmit --pretty false`: pass.
- `npm install acpx`: pass. Real acpx API alignment is pending.
- `acpx@0.12.0` package inspection: pass. Exports include `acpx`, `acpx/runtime`, and `acpx/flows`; `@acpx/runtime` is absent.
- Adapter tests now verify real `acpx/runtime` and `acpx/flows` exports.
