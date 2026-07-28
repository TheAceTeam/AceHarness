# Recent Verification

Updated: 2026-07-09

## 2026-07-09 Task List Bootstrap

- Scope: Created implementation task list from `ACPX_ENGINE_MIGRATION_SPEC.md` and current repository scans.
- Evidence: Read `package.json`, `src/client/db/collections.ts`, `src/client/query/query-keys.ts`, and file listings for `src/lib/engines`, `src/server/api-routes/engine`, and `src/client/query`.
- Result: Partial. Task documents created; no implementation tests run.
- Follow-up: Start Task 1 and record compile/static scan evidence after runtime contracts are added.

## 2026-07-09 Dependency Install And Parallel Dispatch

- Scope: Installed npm dependencies and dispatched Task 1, Task 2, and Task 3 to parallel subagents.
- Evidence: `npm install` completed with 1175 packages added. Subagents: Pauli for runtime contracts, Gauss for runtime SQLite schema/store skeleton, Volta for agent registry/icons.
- Result: Partial. Install passed; implementation results pending.
- Follow-up: Review subagent patches, update task progress, and run targeted tests.

## 2026-07-09 Runtime Foundation Batch 1 Review

- Scope: Reviewed Task 1 contracts, Task 2 runtime SQLite schema/store skeleton, and Task 3 agent registry/icon skeleton.
- Evidence: `npx vitest run tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`.
- Result: Pass. 3 test files passed, 17 tests passed.
- Follow-up: `npx tsc --noEmit --pretty false` still fails on `src/client/pages/workbench/WorkbenchClient.tsx(8952,60)` and `src/start.ts(17,17)`, which are tracked as verification gaps because they are outside this batch.

## 2026-07-09 Runtime Foundation Batch 2 Review

- Scope: Reviewed Task 4 model route SQLite helpers, Task 5 permission/env/secret helpers, and Task 9 TanStack client state skeleton.
- Evidence: `npx vitest run tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`.
- Result: Pass. 6 test files passed, 33 tests passed.
- Follow-up: `npx tsc --noEmit --pretty false` still fails only on `src/client/pages/workbench/WorkbenchClient.tsx(8952,60)` and `src/start.ts(17,17)`.

## 2026-07-09 Adapter Skeleton And TypeScript Baseline

- Scope: Reviewed Task 6 adapter skeleton and Task 12 TypeScript baseline cleanup.
- Evidence: `npx vitest run tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-adapters.test.ts`; `npx tsc --noEmit --pretty false`; `npm install acpx`.
- Result: Pass. 7 test files passed, 40 tests passed. TypeScript passed. `acpx` package installed after initial adapter inspection found it absent.
- Follow-up: Re-check real acpx exports and align `AcpxAdapter` with installed package API.

## 2026-07-09 acpx Export Alignment

- Scope: Rechecked installed `acpx@0.12.0` and aligned adapter tests with real package exports.
- Evidence: `npx vitest run tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-adapters.test.ts`; `npx tsc --noEmit --pretty false`.
- Result: Pass. 7 test files passed, 40 tests passed. TypeScript passed.
- Follow-up: Real execution wiring remains for `AcpxRuntime` and Magic runtime clients.

## 2026-07-09 Runtime Check Script Skeletons

- Scope: Added runtime-first verification script skeletons and synchronized Task 7, Task 8, Task 12, README, and gap status with current repository facts.
- Evidence: Added `check:runtime:availability`, `check:runtime:chat`, `check:runtime:session`, `check:runtime:trace`, and `check:runtime:model-routes`; ran `npm run check:runtime:availability -- --tier core --json`, `npm run check:runtime:session -- --json`, `npm run check:runtime:model-routes -- --json`, `npm run check:runtime:trace -- --json`, `npm run check:runtime:chat -- --json`, and `npx vitest run tests/api-runtime-sessions-route.test.ts`.
- Result: Pass. Availability resolved codex/claude/opencode and reported missing cangjie-magic; session/model-route/trace checks passed; chat check passed as adapter skeleton and reported `ADAPTER_UNAVAILABLE` because no runtime client is configured; runtime-sessions route skeleton tests passed, 6 tests.
- Follow-up: Add focused orchestrator tests. Expand scripts after default runtime API service wiring and real `AcpxRuntime` execution land.

## 2026-07-09 Runtime Orchestrator And API Vertical Slice

- Scope: Added `RuntimeOrchestrator` focused tests, wired `/api/runtime-sessions/*` default service to SQLite store plus orchestrator, updated agent icon registry to use local SVG assets, and added `acpx/runtime` TypeScript declarations for installed package exports.
- Evidence: `npx tsc --noEmit --pretty false`; `npx vitest run tests/api-runtime-sessions-route.test.ts tests/runtime-orchestrator.test.ts tests/runtime-sqlite-schema.test.ts tests/model-routes-sqlite.test.ts tests/agent-registry.test.ts`; `npm run check:runtime:session -- --json`.
- Result: Pass. TypeScript passed. 5 targeted test files passed, 29 tests. Runtime session check passed with idempotent turn, claimed running status, and first event seq.
- Follow-up: Real `AcpxRuntime` execution wiring, compact/fork/traces/diagnostic routes, migration dry-run, and oldArchitecture consumer migration remain.

## 2026-07-09 Adapter Runtime Bridge

- Scope: Added injected acpx runtime bridge support in `AcpxAdapter`, explicit unavailable cancel semantics for acpx/Magic adapters, and adapter tests for `ensureSession`/`startTurn` bridging.
- Evidence: `npx vitest run tests/runtime-adapters.test.ts`; `npx tsc --noEmit --pretty false`.
- Result: Pass. Runtime adapter tests passed, 9 tests. TypeScript passed.
- Follow-up: Build the real `AcpxRuntimeClient` construction layer that imports `acpx/runtime` and injects runtime/store/agent registry methods; provide the real Magic runtime client.

## 2026-07-09 Runtime Adapter, Orchestrator, And API Follow-Up

- Scope: Reviewed subagent patches for real acpx runtime client translation, permission/profile mapping, non-stream turn execution, request idempotency, running cancel final status, compact/fork routes, traces route, and redacted trace reads.
- Evidence: Subagent verification reports for `npx vitest run tests/runtime-adapters.test.ts`, `npx vitest run tests/runtime-orchestrator.test.ts`, `npx vitest run tests/api-runtime-sessions-route.test.ts`, and `npx tsc --noEmit --pretty false`.
- Result: Pass in focused batches. Runtime adapter tests passed with 11 tests; orchestrator tests passed with 6 tests; runtime session route tests passed with 10 tests; TypeScript passed in each reported batch.
- Follow-up: Owner/admin authorization, interrupt policy behavior, diagnostic bundle redaction vectors, process-level acpx execution, Magic runtime client, and oldArchitecture consumer migration remain.

## 2026-07-09 Runtime Session Owner Authorization

- Scope: Reviewed subagent patch adding owner/admin authorization to per-session runtime routes.
- Evidence: Static route audit found `authorizeRuntimeSessionAccess` applied to GET session/events/traces and POST turns/cancel/compact/fork/turn-cancel routes; subagent reported `npx vitest run tests/api-runtime-sessions-route.test.ts` passed with 11 tests and `npx tsc --noEmit --pretty false` passed.
- Result: Pass in focused route batch.
- Follow-up: Diagnostic bundle route and fail-closed redaction vectors remain.

## 2026-07-09 Runtime Diagnostics Bundle Redaction

- Scope: Reviewed subagent patch adding `GET /api/runtime-sessions/:id/diagnostics`, service-level diagnostics aggregation, authorization reuse, and fail-closed sanitizer coverage.
- Evidence: Static route/test scan found diagnostics route, `readDiagnostics`, sanitizer reuse, and tests for API key, Bearer token, private key, stderr/stdout/tool IO, raw binding JSON, diff, and command redaction. Subagent reported `npx vitest run tests/api-runtime-sessions-route.test.ts` passed with 13 tests and `npx tsc --noEmit --pretty false` passed.
- Result: Pass in focused route batch.
- Follow-up: Diagnostics pagination is not implemented; current minimal bundle reads bounded events/traces.

## 2026-07-09 Runtime SQLite Store Closeout

- Scope: Reviewed Task 2 closeout patch for runtime SQLite store/schema coverage.
- Evidence: Static scan confirmed `reclaimExpiredLeases`, projection cache read API, binding list API, agent runtime state access, WAL/busy timeout assertions, projection rollback test, and store API coverage in `tests/runtime-sqlite-schema.test.ts`. Subagent reported `npx vitest run tests/runtime-sqlite-schema.test.ts` passed with 10 tests and `npx tsc --noEmit --pretty false` passed.
- Result: Pass. Task 2 is marked done.
- Follow-up: Task 7 may later tighten orchestrator scheduling around explicit lease reclaimer calls.

## 2026-07-09 Runtime Agent Registry Closeout

- Scope: Reviewed Task 3 closeout patch for runtime agent registry, icon policy, SQLite agent runtime state, and `/api/agents` merged output.
- Evidence: Static scan confirmed runtime registry route output, oldArchitecture list fields, SQLite agent runtime state read/write methods, command resolver probe specs, local icon coverage, and focused route test. Subagent reported `npx vitest run tests/agent-registry.test.ts tests/api-agents-runtime-registry.test.ts` passed with 7 tests and `npx tsc --noEmit --pretty false` passed.
- Result: Pass. Task 3 is marked done.
- Follow-up: Monitor old consumers that may still expect raw YAML-only `_file` entries; common oldArchitecture list fields are preserved.

## 2026-07-09 Runtime Model Routes Closeout

- Scope: Reviewed Task 4 patches for SQLite-backed model routes, `/api/models`, YAML import/export, deterministic resolution, and model probe `modelRouteId` migration.
- Evidence: Static scan confirmed runtime DTO fields on `/api/models`, probe type support for `modelRouteId`, persisted probe route id usage, `recordModelProbeObservation` route-id matching, route-id query filtering, and route-id-based execution identity before the oldArchitecture execution bridge. Subagents reported `npx vitest run tests/model-routes-sqlite.test.ts tests/api-models-route.test.ts` passed with 10 tests, `npx vitest run tests/api-models-route.test.ts` passed with 9 tests after probe migration, and `npx tsc --noEmit --pretty false` passed.
- Result: Pass. Task 4 is marked done.
- Follow-up: Full runtime execution will remove the isolated oldArchitecture probe execution bridge in later tasks.

## 2026-07-09 Runtime Security Profiles Closeout

- Scope: Reviewed Task 5 patch for permission policies, env/secret profile persistence, readiness checks, runtime env snapshots, redaction, and audit event/trace behavior.
- Evidence: Static scan confirmed `env_profiles`, `secret_profiles`, `permission_policies` schema ownership/visibility fields and indexes, store CRUD/list access boundaries, secret readiness checks, and tests covering redaction, conflict metadata, profile persistence, and acpx permission mapping. Subagent reported `npx vitest run tests/runtime-security-profiles.test.ts tests/runtime-adapters.test.ts` passed with 20 tests, `npx vitest run tests/runtime-sqlite-schema.test.ts` passed with 10 tests, and `npx tsc --noEmit --pretty false` passed.
- Result: Pass. Task 5 is marked done.
- Follow-up: HTTP profile management routes can be added later when UI migration needs them.

## 2026-07-09 Runtime Adapters Closeout

- Scope: Reviewed Task 6 patch for AcpxAdapter, AcpxRuntimeClient, MagicAdapter, adapter event normalization, and availability proof.
- Evidence: Static scan confirmed canonical acpx/Magic terminal event mapping, Magic client run/cancel/status/close semantics, redacted adapter errors, no runtime adapter imports from `src/lib/engines`, and tests covering controlled `acpx/runtime` construction across ensureSession/startTurn/cancel/status/close. Subagent reported `npx vitest run tests/runtime-adapters.test.ts` passed with 14 tests, `npx tsc --noEmit --pretty false` passed, and `npm run check:runtime:availability -- --json` passed while explicitly reporting missing local external commands.
- Result: Pass. Task 6 is marked done.
- Follow-up: Later runtime consumer migration will remove oldArchitecture execution paths outside runtime adapters.

## 2026-07-09 Runtime Orchestrator Closeout

- Scope: Reviewed Task 7 patch for orchestrator interrupt policies, cancellation races, compact/fork saga, graph isolation, projections, browser disconnect behavior, and native id redaction.
- Evidence: Static scan confirmed cancel-and-send isolation fork on cancel failure, FIFO queued claim/requestId idempotency tests, operation statuses including `external-running`, `finalizing`, `compensating`, and `compensated`, projection update/rebuild helpers, browser disconnect test, and native id redaction tests. Subagent reported `npx vitest run tests/runtime-orchestrator.test.ts` passed with 16 tests and `npx tsc --noEmit --pretty false` passed.
- Result: Pass. Task 7 is marked done.
- Follow-up: Native compact/fork semantics can be refined later if external runtimes expose deeper support.

## 2026-07-09 Runtime API Routes Closeout

- Scope: Reviewed Task 8 patch for `/api/runtime-sessions/*` route streaming behavior and runtime API coverage.
- Evidence: Static scan confirmed SSE/NDJSON event formatting, terminal event flush then close, keepalive heartbeat, structured `turn.failed` stream error DTOs, owner/admin authorization reuse, cursor/limit checks, and diagnostics redaction coverage. Ran `npx vitest run tests/api-runtime-sessions-route.test.ts` and `npx tsc --noEmit --pretty false`.
- Result: Pass. Runtime session route tests passed, 16 tests. TypeScript passed. Task 8 is marked done.
- Follow-up: Backpressure remains platform `ReadableStream` behavior; real process-level `AcpxRuntime` streaming should be rechecked during later runtime consumer migration.

## 2026-07-09 Runtime Client State Closeout

- Scope: Reviewed Task 9 patch for runtime Query keys, TanStack DB collections, initial snapshot sync, SSE/NDJSON delta upserts, batching, and sensitive-field blocking.
- Evidence: Static scan confirmed runtime client paths use `/api/runtime-sessions/:id`, initial snapshot combines the existing session and events routes, query keys reject unsafe runtime key material, client rows normalize through platform-facing allow-lists, and stream parser/upsert helpers use batched collection writes. Ran `npx vitest run tests/runtime-client-state.test.ts tests/api-runtime-sessions-route.test.ts` and `npx tsc --noEmit --pretty false`.
- Result: Pass. Runtime client state plus runtime sessions route tests passed, 24 tests. TypeScript passed. Task 9 is marked done.
- Follow-up: Task 10 UI work must reuse these helpers instead of opening separate unfiltered stream/cache paths.

## 2026-07-09 oldArchitecture Boundary Guard

- Scope: Reviewed Task 11 boundary guard and migration-only marking for old engine API.
- Evidence: `npm run check:runtime:old-architecture-boundaries -- --json` passed with zero findings for new runtime core/API/client-state/check surfaces. `/api/engine` route now returns `migrationOnly: true` and `x-ace-migration-only: old-architecture-engine-api`.
- Result: Partial pass at the time. New runtime boundaries were protected, while chat/spec-coding/agent-chat still needed migration before pruning `src/lib/engines`, SDK dependencies, and oldArchitecture engine tests.
- Follow-up: Later Task 11 batches moved chat/model execution to runtime-backed compatibility and centralized Workflow/spec-coding behind `runtime-facade`; remaining cleanup is `/api/engine` compatibility, facade removal, wrapper/test/dependency pruning.

## 2026-07-09 Task 12 Verification Scripts Closeout

- Scope: Closed Task 12 verification scripts, migration dry-run, consistency check, and static runtime boundary scans while Task 11 ran in parallel.
- Evidence: `npm run check:runtime:availability -- --tier core --json`; `npm run check:runtime:session -- --json`; `npm run check:runtime:model-routes -- --json`; `npm run check:runtime:trace -- --json`; `npm run check:runtime:old-architecture-boundaries -- --json`; `npm run check:runtime:chat -- --json`; `npm run check:runtime:consistency -- --json`; `npm run check:runtime:migration-dry-run -- --json`; `npx vitest run tests/runtime-adapters.test.ts tests/runtime-orchestrator.test.ts tests/api-runtime-sessions-route.test.ts tests/runtime-client-state.test.ts tests/api-agents-runtime-registry.test.ts tests/model-routes-sqlite.test.ts`; `npx tsc --noEmit --pretty false`.
- Result: Pass. Runtime scripts use `agentId`/`modelRouteId`/`profileSnapshot` semantics. Static scans reported zero forbidden `src/lib/engines` imports in runtime production/check surfaces and zero blocking native id findings in ordinary DTO/query/client cache surfaces. Focused tests passed, 6 files and 61 tests. TypeScript passed.
- Notes: `check:runtime:availability` resolved codex, claude, and opencode; cangjie-magic was missing locally. `check:runtime:chat` passed as adapter skeleton and reported `ADAPTER_UNAVAILABLE` because no process-level runtime client is injected. Migration dry-run parsed/imported 44 catalog rows, 2 providers, and 95 routes with zero errors and two warnings for oldArchitecture `magic-cli` routes that do not map to a builtin runtime agent id.
- Follow-up: Full `npm test` and `npm run lint` were not run in this focused concurrent slice. Real process-level `AcpxRuntime` execution remains unproven.

## 2026-07-09 Engines Availability And Group Chat Fork

- Scope: Reviewed subagent fixes for `/engines` runtime-agent rendering, strict availability semantics, explicit engine switching, and group-chat fork behavior.
- Evidence: `src/client/pages/EnginesPage.tsx` now uses runtime agent options and normalizes oldArchitecture ids to runtime agent ids; engine card click no longer calls selection. `src/client/query/engines.ts` and `src/server/api-routes/engine/availability/route.ts` now mark only `status === 'available'` as available. `src/lib/chat/fork-session.ts` and `src/components/chat/ChatPageContent.tsx` split plain session fork from collaboration fork and clear copied `agentSessions`.
- Result: Pass in focused batches. Subagents reported `npx vitest run tests/api-engine-old-architecture-routes.test.ts tests/client-engine-availability.test.ts` passed with 10 tests, `npx vitest run tests/chat-context.test.tsx --environment jsdom` passed with 13 tests, and `npx tsc --noEmit --pretty false` passed for the UI slices.
- Follow-up: Browser-level visual verification of `/engines` and group-chat fork remains useful, but the data-source, availability, and fork-state semantics now have focused proof.
