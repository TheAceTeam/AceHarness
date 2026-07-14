# Task 6: Runtime Adapters For acpx And Magic

Progress: 100%
Status: Done

## Goal

Implement `AcpxAdapter` for all acpx-supported non-Magic agents and `MagicAdapter` for `cangjie-magic`.

## Completed

- Spec says acpx is the main adapter and Magic implements the same ACEHarness adapter contract.
- `AcpxAdapter` now supports injected runtime clients, normalizes returned native events, and keeps native ids inside runtime bindings.
- `createAcpxRuntimeClient` now imports the installed `acpx/runtime` surface, constructs runtime/store/agent-registry dependencies, translates session and turn calls, and maps ACEHarness permission/profile values into acpx runtime options.
- `MagicAdapter` implements the same ACEHarness adapter contract and now covers run, cancel, status, and close through an explicit Magic runtime client boundary.
- Adapter registry routes `cangjie-magic` to `MagicAdapter`; other builtin/unknown agents default to `AcpxAdapter`.
- `acpx@0.12.0` is declared in `package.json`; installed environments can deep-check `acpx/runtime` and `acpx/flows` exports.
- Adapter tests prove canonical terminal event normalization, usage/cost missing semantics, native id redaction, and no runtime adapter import from `src/lib/engines`.
- Availability check reports missing external commands explicitly instead of treating unavailable agents as runnable.

## Follow-Up Work

- Real process execution depends on local external agent commands. The runtime availability script reports unavailable commands explicitly.

## Acceptance

- Non-Magic core/verified agents route through `AcpxAdapter`.
- `cangjie-magic` routes through `MagicAdapter`.
- No new SDK driver branch is added.
- Adapter events normalize into canonical runtime events and hide provider ids from ordinary DTOs.

## Verification Record

- Adapter subagents completed the injected acpx runtime bridge, real acpx runtime client translation, permission/profile mapping, and explicit cancel failure semantics.
- `npx vitest run tests/runtime-adapters.test.ts`: pass, 11 tests.
- `npx vitest run tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-adapters.test.ts`: pass, 40 tests before orchestrator/API additions.
- `npx tsc --noEmit --pretty false`: pass.
- `npm install acpx`: pass. Real acpx API alignment is pending.
- `acpx@0.12.0` package inspection: pass. Exports include `acpx`, `acpx/runtime`, and `acpx/flows`; `@acpx/runtime` is absent.
- Adapter tests now verify package declaration, real `acpx/runtime` and `acpx/flows` exports when installed, runtime client translation, permission/profile mapping, native id redaction, usage/cost missing semantics, routing, and explicit cancel failure.
- 2026-07-09 Task 6 worker closeout: `npx vitest run tests/runtime-adapters.test.ts` pass, 14 tests. Added focused coverage for `createAcpxRuntimeClient` controlled `acpx/runtime` construction path across ensureSession/startTurn/cancel/status/close, canonical acpx/Magic terminal event normalization, Magic run/cancel/status/close client semantics, outward native id redaction, and adapter no-old-architecture-engines imports.
- 2026-07-09 Task 6 worker closeout: `npx tsc --noEmit --pretty false` pass.
- 2026-07-09 Task 6 worker closeout: `npm run check:runtime:availability -- --json` pass. Report explicitly marked local `cangjie-magic`, `kiro`, `trae`, `nga`, `codegenie`, and formal ACPX agents unavailable when commands were not found instead of silently treating them as runnable.
