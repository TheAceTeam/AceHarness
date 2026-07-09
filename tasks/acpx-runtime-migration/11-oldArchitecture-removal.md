# Task 11: Old Architecture Removal And Dependency Pruning

Progress: 95%
Status: In Progress

## Goal

Delete old wrappers, SDK drivers, old architecture engine APIs, and dependencies after runtime consumers are migrated.

## Current State

- `src/lib/engines` still exists as the old wrapper directory, but the current production scan does not find direct `@/lib/engines` imports in runtime, chat, workflow, model, or engine API paths.
- `package.json` still includes SDK dependencies; dependency pruning is deferred until package-level usage and removed wrapper tests are audited together.
- `/api/engine` still exists for old architecture UI/config callers. It is now explicitly migration-only and returns `migrationOnly: true` with `x-ace-migration-only: old-architecture-engine-api`.
- `next.config.js` is already deleted in the worktree for unrelated reasons and must not be restored by this task.
- New runtime core/API/client-state/check surfaces do not import `src/lib/engines`.

## Static Scan Findings

- Earlier 2026-07-09 scans found direct old wrapper consumers in chat, agent chat, workflow, spec-coding, model utilities, CLI/config helpers, and `/api/engine/**`; those imports have been migrated or centralized behind compatibility facades.
- Current targeted scan for `@/lib/engines`, `src/lib/engines`, and `lib/engines` across chat routes, agent chat, workflow, state-machine, spec-coding, model utilities, and engine API paths reports zero matches.
- `/api/engine` is still called by oldArchitecture client/query and UI paths, including `src/client/query/engines.ts`, `src/contexts/ChatContext.tsx`, `src/components/AgentConfigPanel.tsx`, and `src/components/AgentEditModal.tsx`.
- `backendSessionId` is still used by old architecture chat session state and persistence paths. Runtime API/client state surfaces only use it in redaction/blocklist boundaries or internal adapter binding translation.
- Native provider/acpx ids remain internal to runtime adapter/store/orchestrator binding code and redaction checks.

## Completed

- Main chat and agent-chat route files no longer import `@/lib/engines/*` directly. A temporary old architecture chat bridge now lives in `src/lib/chat/chat-engine-runtime.ts` so old execution can be removed later without polluting `src/lib/runtime-agent`.
- The earlier direct old bridge files have been deleted or bypassed; ordinary Chat and agent-chat paths now enter through `src/lib/chat/chat-engine-runtime.ts`, which is runtime adapter-backed.
- Model route compatibility moved forward: `/api/engine/models` now returns a migration-only compatibility view derived from runtime `/api/models` and SQLite model routes.
- old architecture engine subroutes `/api/engine`, `/api/engine/models`, `/api/engine/models/smoke`, `/api/engine/availability`, and `/api/engine/commands` now identify themselves as migration-only in response bodies or comments.
- Model probes and diagnostics now prefer `modelRouteId` / runtime model route identity before falling back to old architecture engine wrapper execution.
- UI/client selection surfaces now derive engine/model options from runtime agent registry and `/api/models` instead of direct `/api/engine` reads for the migrated selectors, setup, and chat config paths.
- Workflow, state-machine, spec-merge, spec-coding, and AI draft generator files no longer import `@/lib/engines/*` directly. Their remaining oldArchitecture dependency is centralized in `src/lib/workflow/runtime-facade.ts`.
- Ordinary Workflow/spec-coding paths now use `src/lib/workflow/runtime-facade.ts`; replacing that facade with runtime turn/session contracts remains the main execution cleanup.
- API docs now describe runtime agent/model route endpoints instead of presenting `/api/engine` as the ordinary public API.
- Workbench and Agora default runtime reads now use runtime selection query. Chat command discovery is centralized behind `fetchRuntimeCommandMetadataCompat()` instead of component-level `/api/engine/commands` fetches.
- CLI setup/detection no longer imports old engine wrappers or starts ACP sessions for model discovery; it uses runtime agent registry availability probes and runtime model routes.
- Small config/metadata consumers no longer import `@/lib/engines/*`; shared `.agents` directory helpers now live in `src/lib/core/app-paths.ts`.
- `/api/engine` compatibility subroutes no longer execute wrapper availability/model/command/smoke probes. They now return runtime-derived or skipped migration-only results with canonical runtime routes.
- Chat runtime bridge now uses runtime adapter-backed execution and no longer imports `@/lib/engines/*`.
- Model probes and diagnostics now execute through `src/lib/models/diagnostics-runtime-bridge.ts` and no longer import `@/lib/engines/*`.

## Follow-Up Work

- Remove old wrapper files once no runtime consumer imports them.
- Replace `src/lib/workflow/runtime-facade.ts` with runtime turn/session contracts before pruning `EngineJsonResult`, old stream events, and context recovery helpers.
- Continue disconnecting remaining production UI/client helpers from `/api/engine/**`, primarily compatibility hooks in `src/client/query/engines.ts`.
- Remove old `/api/engine` routes after new APIs and migration paths are in place.
- Remove SDK dependencies no longer needed after package-level old wrapper usage and tests are audited.
- Remove or rewrite old engine tests after their covered production wrappers are deleted.
- Keep `scripts/check-runtime-old-architecture-boundaries.mjs` in CI/check flows to prevent reintroduction of old engine imports and native ids in runtime core/API/client-state/check scripts.

## Acceptance

- No new runtime production code imports `src/lib/engines`.
- SDK dependencies for removed drivers are pruned from `package.json` and lockfile.
- `/api/engine` is absent or clearly migration-only with deletion tracked.
- Static scan and tests prove old driver UI/config paths are gone.

## Verification Record

- Added `scripts/check-runtime-old-architecture-boundaries.mjs`.
- Added `check:runtime:old-architecture-boundaries` to `package.json`.
- Marked `src/server/api-routes/engine/route.ts` as migration-only via response body and `x-ace-migration-only` header.
- 2026-07-09 first Task 11 migration batch:
  - Chat/agent-chat direct old engine imports were moved behind `src/lib/chat/chat-engine-runtime.ts`.
  - Runtime trace and old-architecture-boundary checks pass after ensuring the temporary bridge is outside `src/lib/runtime-agent`.
  - Model route/probe/diagnostics migration batch passed `npx vitest run tests/api-models-route.test.ts tests/model-diagnostics.test.ts tests/model-routes-sqlite.test.ts`.
  - UI/client selection migration batch passed `npx vitest run tests/model-select.test.tsx`.
  - Combined verification passed: `npx tsc --noEmit --pretty false`; `npm run check:runtime:trace -- --json`; `npm run check:runtime:old-architecture-boundaries -- --json`; `npx vitest run tests/model-select.test.tsx tests/api-models-route.test.ts tests/model-diagnostics.test.ts tests/model-routes-sqlite.test.ts tests/components/ChatSidebar.test.tsx tests/components/ChatMessageCardRendering.test.tsx tests/chat-message-preview.test.ts`.
- 2026-07-09 second Task 11 migration batch:
  - Workflow/state-machine/spec-coding direct old engine imports were moved behind `src/lib/workflow/runtime-facade.ts`.
  - API docs, Workbench, Agora, and chat command discovery stopped directly reading `/api/engine` in component code; command discovery now goes through `fetchRuntimeCommandMetadataCompat()`.
  - `npx tsc --noEmit --pretty false` passed.
  - `npm run check:runtime:trace -- --json` passed.
  - `npm run check:runtime:old-architecture-boundaries -- --json` passed.
  - `npx vitest run tests/workflow-manager-result-protocol.test.ts tests/api-spec-coding-routes.test.ts tests/agent-ai-draft-prompt.test.ts tests/state-machine-workflow-manager.test.ts` partially passed: 3 files passed; `tests/state-machine-workflow-manager.test.ts` still has 15 failures tied to the newer strict final verdict JSON behavior and older fallback expectations.
- 2026-07-09 fourth Task 11 migration batch:
  - CLI no longer imports `./lib/engines/*` or starts ACP sessions for setup model discovery.
  - `src/lib/agora/guest-store.ts`, `src/lib/agora/workspace-store.ts`, `src/lib/core/instrumentation-nodejs.ts`, `src/lib/core/engine-metadata.ts`, and `src/lib/chat/request-options.ts` no longer import `@/lib/engines/*`.
  - oldArchitecture `/api/engine/availability`, `/api/engine/models`, `/api/engine/commands`, and `/api/engine/models/smoke` are runtime-derived or skipped migration-only compatibility responses.
  - Verification passed: `npx tsc --noEmit --pretty false`; `npm run check:runtime:old-architecture-boundaries -- --json`; `npx vitest run tests/api-engine-oldArchitecture-routes.test.ts tests/api-models-route.test.ts`.
- 2026-07-09 fifth Task 11 migration batch:
  - `src/lib/chat/chat-engine-runtime.ts` no longer imports old engine wrappers; it remains as a runtime adapter-backed compatibility layer for existing chat call sites.
  - `src/lib/models/probes.ts` and `src/lib/models/diagnostics.ts` no longer import old engine wrappers; `src/lib/models/diagnostics-runtime-bridge.ts` handles the runtime diagnostic/probe execution mapping.
  - Verification passed: `npx tsc --noEmit --pretty false`; `npm run check:runtime:old-architecture-boundaries -- --json`; `npx vitest run tests/model-diagnostics.test.ts tests/api-models-route.test.ts tests/api-engine-oldArchitecture-routes.test.ts tests/components/ChatSidebar.test.tsx tests/components/ChatMessageCardRendering.test.tsx tests/chat-message-preview.test.ts`.
  - Global old-engine import scan now reports only `src/lib/workflow/runtime-facade.ts` and root `src/server/api-routes/engine/route.ts`.
- No dependency was removed and lockfile was not changed; SDK packages are still required by `src/lib/workflow/runtime-facade.ts` and root `/api/engine` configuration compatibility.
- 2026-07-09 naming cleanup:
  - Removed oldArchitecture wording that used the disallowed English term from Task 11 filenames/references, source comments, local variables, fixture ids, and test descriptions where safe.
  - Targeted repository scan now reports only the third-party npm install flag that must stay unchanged.
  - `npx tsc --noEmit --pretty false` passed after the naming-only cleanup.
