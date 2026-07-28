# Task 4: Model Routes SQLite Migration

Progress: 100%
Status: Done

## Goal

Move runtime model execution from YAML/oldArchitecture `ModelOption` to SQLite-backed model catalog and model routes.

## Completed

- `configs/models/models.yaml` exists and remains useful as seed/import/export only.
- Runtime model routes are SQLite-backed through `model_catalog`, `model_providers`, `model_routes`, `model_pricing`, and `model_discovery_cache`.
- `/api/models` reads and writes SQLite-backed model route data and exports YAML only as a migration compatibility seed.
- Route resolution supports explicit `modelRouteId` and deterministic fallback by default route, priority, verification time, and id.
- Model probes now persist and prefer `modelRouteId`; oldArchitecture `engine + model` remains only as compatibility input/display and as an isolated oldArchitecture execution bridge.

## Follow-Up Work

- Replace the isolated oldArchitecture probe execution bridge when Task 7/8/11 finish moving execution fully onto runtime orchestrator APIs.

## Acceptance

- Runtime execution accepts `modelRouteId` rather than `engine + model`.
- Every active `(agentId, modelId)` has at most one active default route.
- Route resolution is deterministic when priority ties.
- YAML import/export works without making YAML the runtime source of truth.

## Verification Record

- Assigned to subagent for schema/resolver seed implementation; result pending.
- `npx vitest run tests/model-routes-sqlite.test.ts`: pass.
- `npx vitest run tests/model-routes-sqlite.test.ts tests/runtime-security-profiles.test.ts tests/runtime-client-state.test.ts tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`: pass, 33 tests.
- `npx tsc --noEmit --pretty false`: fail only on remaining baseline gaps in `WorkbenchClient.tsx` and `src/start.ts`.
- 2026-07-09 Task 4 worker收口：
  - SQLite schema/resolver/seed tests cover `model_catalog`, `model_providers`, `model_routes`, `model_pricing`, `model_discovery_cache`, default route partial unique index, explicit `modelRouteId` resolve, deterministic tie-break, and YAML import/export.
  - `/api/models` GET now reads SQLite-backed catalog/routes and returns runtime DTO fields `modelRouteId`/`agentId`/`provider`/`providerModel`; POST replaces SQLite runtime model rows and exports YAML only as migration compatibility seed.
  - Probe API route DTO boundary accepts `modelRouteId`, resolves it through SQLite routes for the oldArchitecture probe service call, returns `modelRouteId`, and supports `modelRouteId` query filtering.
  - Verification: `npx vitest run tests/model-routes-sqlite.test.ts tests/api-models-route.test.ts` pass, 10 tests.
  - Verification: `npx tsc --noEmit --pretty false` pass.
- 2026-07-09 Task 4 follow-up probe底层迁移：
  - `ModelProbeRecord/Create/Update/Summary/Observation` now support `modelRouteId`; create/update persist it and resolve SQLite routes to compatibility display fields (`agentId`/`providerModel`/provider endpoints).
  - Probe list/query/observation/run paths now prefer `modelRouteId`; oldArchitecture `engine + model` remains as compatibility input and execution is isolated behind a oldArchitecture engine bridge.
  - Verification: `npx vitest run tests/api-models-route.test.ts` pass, 9 tests.
  - Verification: `npx tsc --noEmit --pretty false` pass.
