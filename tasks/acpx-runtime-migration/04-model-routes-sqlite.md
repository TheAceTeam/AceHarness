# Task 4: Model Routes SQLite Migration

Progress: 45%
Status: In Progress

## Goal

Move runtime model execution from YAML/legacy `ModelOption` to SQLite-backed model catalog and model routes.

## Current State

- `configs/models/models.yaml` exists and remains useful as seed/import/export only.
- Existing model routes still use legacy engine/model terminology in API and UI.
- The spec requires deterministic route resolution using `modelRouteId`, default route, priority, verification time, and id.

## Follow-Up Work

- Implement `model_catalog`, `model_providers`, `model_routes`, `model_pricing`, and discovery cache schema.
- Implement YAML seed/import/export.
- Implement route resolver and default route partial unique index.
- Migrate model probes to `modelRouteId`.
- Update model API DTOs so old fields appear only in migration import/export reports.

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
