# Task 12: Verification, Scripts, And Migration Checks

Progress: 100%
Status: Done

## Goal

Update tests, check scripts, migration dry-run, diagnostics, and verification evidence for the completed runtime migration.

## Current State

- `package.json` now has runtime-first entries: `check:runtime:availability`, `check:runtime:chat`, `check:runtime:session`, `check:runtime:trace`, `check:runtime:model-routes`, `check:runtime:migration-dry-run`, and `check:runtime:consistency`.
- oldArchitecture entries `check:engines`, `check:engine-chat`, and `check:acp` still exist and still target old engine/ACP surfaces.
- Spec requires runtime availability, chat, session, trace, model route, and agent registry checks.
- Runtime check scripts intentionally do not import old `engine-factory` or `src/lib/engines`.
- Focused adapter, orchestrator, and runtime session route tests now cover real acpx client translation, non-stream turn execution, idempotency, running cancel final status, compact/fork, diagnostics bundles, and redacted traces.
- `check:runtime:chat` currently verifies adapter skeleton behavior and reports `ADAPTER_UNAVAILABLE` without failing when no runtime client is injected.
- Migration dry-run uses the model YAML seed as migration input, imports into an in-memory runtime SQLite DB, reports plan/counts/warnings/errors, and emits a oldArchitecture id map preview.
- Consistency check verifies merged agent registry, model route resolution, and profile snapshot identity through `agentId`/`modelRouteId`.

## Follow-Up Work

- Expand `check:runtime:chat` from adapter skeleton proof to process-level real runtime execution once a local `AcpxRuntime` client is configured for CI.
- Extend redaction test vectors when new runtime payload shapes are added.
- Run full `npm test` and `npm run lint` in a dedicated validation slice; this closeout ran focused runtime/API tests to avoid colliding with Task 11/12 parallel work.

## Acceptance

- Check scripts use `agent/modelRoute/profile` rather than `engine/driver/model`.
- Migration dry-run reports plan, counts, warnings, errors, and oldArchitecture id map preview.
- Redaction tests fail closed on diagnostic bundle export.
- Final verification includes commands and summarized results in `verification-log.md`.

## Verification Record

- Added `scripts/check-runtime-availability.mjs`, `scripts/check-runtime-chat.cjs`, `scripts/check-runtime-session.mjs`, `scripts/check-runtime-trace.mjs`, and `scripts/check-runtime-model-routes.mjs`.
- Added `scripts/check-runtime-migration-dry-run.mjs` and `scripts/check-runtime-consistency.mjs`.
- Added package scripts `check:runtime:availability`, `check:runtime:chat`, `check:runtime:session`, `check:runtime:trace`, `check:runtime:model-routes`, `check:runtime:migration-dry-run`, and `check:runtime:consistency`.
- `npx tsc --noEmit --pretty false`: pass after baseline fixes in `WorkbenchClient.tsx` and `src/types/import-meta-env.d.ts`.
- Runtime target tests: pass in focused batches after adapter/orchestrator/API additions.
- `npx vitest run tests/runtime-adapters.test.ts`: pass, 11 tests.
- `npx vitest run tests/runtime-orchestrator.test.ts`: pass, 6 tests.
- `npx vitest run tests/api-runtime-sessions-route.test.ts`: pass, 10 tests.
- `npx vitest run tests/api-runtime-sessions-route.test.ts`: pass, 13 tests after diagnostics bundle and redaction coverage.
- `npm run check:runtime:availability -- --tier core --json`: pass. Core command probe resolved codex, claude, and opencode; cangjie-magic was missing.
- `npm run check:runtime:session -- --json`: pass. In-memory runtime DB created a session, idempotent turn, claimed running turn, and first event seq.
- `npm run check:runtime:model-routes -- --json`: pass. In-memory model route resolved by `modelRouteId`.
- `npm run check:runtime:trace -- --json`: pass. Runtime production roots/check scripts have zero forbidden `src/lib/engines` imports; ordinary DTO/query/client cache scan had zero blocking provider/native-id findings. Adapter binding contract fields remain allowed only in `src/lib/runtime-agent/contracts.ts`; client cache deny-list constants are allowed as fail-closed blockers.
- `npm run check:runtime:chat -- --json`: pass as skeleton. It emitted `turn.started` then `turn.failed` with `ADAPTER_UNAVAILABLE` because no runtime client is configured.
- `npm run check:runtime:old-architecture-boundaries -- --json`: pass. Zero findings in new runtime core/API/client-state/check surfaces.
- `npm run check:runtime:consistency -- --json`: pass. Agent registry, model route resolution, and profile snapshot identity matched `codex/runtime-consistency-route`.
- `npm run check:runtime:migration-dry-run -- --json`: pass. Parsed/imported 44 catalog rows, 2 providers, and 95 routes into in-memory SQLite; reported 80 default routes, zero errors, and two warnings for oldArchitecture `magic-cli` model routes that do not map to a builtin runtime agent id.
- `npx vitest run tests/runtime-adapters.test.ts tests/runtime-orchestrator.test.ts tests/api-runtime-sessions-route.test.ts tests/runtime-client-state.test.ts tests/api-agents-runtime-registry.test.ts tests/model-routes-sqlite.test.ts`: pass, 6 files and 61 tests.
- `npx tsc --noEmit --pretty false`: pass.
- Full `npm test` and `npm run lint` were not run in this slice to keep the concurrent Task 11/12 closeout focused and avoid long-running unrelated validation; they remain repository-level verification gates.
