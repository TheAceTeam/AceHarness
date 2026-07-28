# ACPX Runtime Migration Task List

Updated: 2026-07-09

This document is based on `ACPX_ENGINE_MIGRATION_SPEC.md`, current repository scans, `package.json`, `src/lib/engines`, `src/server/api-routes/engine`, `src/client/query/query-keys.ts`, and `src/client/db/collections.ts`. It is an implementation plan and acceptance checklist for replacing the existing Engine wrapper/SDK/stdio runtime with the Runtime-first acpx architecture.

## Entrypoints

- [Design locks](00-design-locks.md)
- [Recommended implementation order](implementation-order.md)
- [Current verification gaps](verification-gaps.md)
- [Recent verification](verification-log.md)
- [Out of scope](out-of-scope.md)
- [Archive](archive.md)

## Task Documents

- [Task 1: Runtime Contracts And Package Boundary](01-runtime-contracts.md)
- [Task 2: SQLite Runtime Schema And Stores](02-runtime-sqlite-stores.md)
- [Task 3: Agent Registry And Icons](03-agent-registry.md)
- [Task 4: Model Routes SQLite Migration](04-model-routes-sqlite.md)
- [Task 5: Permission, Env, And Secret Profiles](05-permission-env-secrets.md)
- [Task 6: Runtime Adapters For acpx And Magic](06-runtime-adapters.md)
- [Task 7: Runtime Orchestrator, Queue, And Session Graph](07-runtime-orchestrator.md)
- [Task 8: Runtime API Routes And Streaming](08-runtime-api-routes.md)
- [Task 9: TanStack Client State Layer](09-tanstack-client-state.md)
- [Task 10: UI Migration For Engines, Models, Chat, Settings](10-ui-migration.md)
- [Task 11: Old Architecture Removal And Dependency Pruning](11-oldArchitecture-removal.md)
- [Task 12: Verification, Scripts, And Migration Checks](12-verification-scripts.md)

## Current Judgment

- The repo is already on TanStack Start/Router/Query/DB/Virtual, so the migration should extend existing query keys and client collections instead of adding a parallel frontend state layer.
- `src/lib/engines` still contains the old wrapper boundary and must not be imported by new runtime core or new runtime check scripts.
- Runtime session/orchestrator and `/api/runtime-sessions/*` are now wired through a SQLite-backed default service for the first vertical slice; real `AcpxRuntime` execution and broader consumer migration still remain.
- `next.config.js` is already deleted in the worktree before this task list; this task list does not depend on restoring it.
- The migration is intentionally breaking. Compatibility belongs only in migration tooling and temporary shims.

## Overview

| Progress | Task | Status | Notes |
|----------|------|--------|-------|
| 100% | Task 1: Runtime Contracts And Package Boundary | Done | Runtime contracts added and targeted tests passed. |
| 100% | Task 2: SQLite Runtime Schema And Stores | Done | Runtime schema/store APIs, explicit lease reclaimer, projection rollback proof, and focused tests are complete. |
| 100% | Task 3: Agent Registry And Icons | Done | Runtime registry, local icon policy, SQLite agent runtime state, and `/api/agents` merged output are complete. |
| 100% | Task 4: Model Routes SQLite Migration | Done | SQLite-backed model routes, `/api/models`, YAML seed import/export, deterministic resolution, and modelRouteId-based probes are complete. |
| 100% | Task 5: Permission, Env, And Secret Profiles | Done | Permission policies, env/secret profile persistence, readiness checks, redaction, audit events/traces, and acpx permission mapping are complete. |
| 100% | Task 6: Runtime Adapters For acpx And Magic | Done | AcpxAdapter, AcpxRuntimeClient, MagicAdapter contract behavior, canonical event normalization, and availability proof are complete. |
| 100% | Task 7: Runtime Orchestrator, Queue, And Session Graph | Done | RuntimeOrchestrator covers sessions, turns, interrupt policies, cancellation, compact/fork saga, projections, traces, and graph isolation. |
| 100% | Task 8: Runtime API Routes And Streaming | Done | Runtime session routes, SQLite-backed service, owner/admin authorization, diagnostics redaction, SSE/NDJSON terminal flush, keepalive, and structured stream error coverage are complete. |
| 100% | Task 9: TanStack Client State Layer | Done | Runtime query keys, TanStack DB collections, safe snapshot sync, SSE/NDJSON delta upsert, batching, and sensitive-field blocking are complete. |
| 100% | Task 10: UI Migration For Engines, Models, Chat, Settings | Done | Engines now render runtime agents with strict availability semantics and explicit switch actions; models, chat, settings, login toast, Skills layout, and group-chat fork behavior have focused verification. |
| 95% | Task 11: Old Architecture Removal And Dependency Pruning | In Progress | Chat/model paths use runtime-backed compatibility, Workflow/spec-coding are centralized behind `runtime-facade`, direct old engine imports are no longer found in targeted production scans, and remaining cleanup is `/api/engine` compatibility, facade removal, wrapper/test/dependency pruning. |
| 100% | Task 12: Verification, Scripts, And Migration Checks | Done | Runtime-first trace, consistency, migration dry-run, old-architecture-boundary, chat/session/model-route checks pass; focused runtime/API tests and TypeScript pass. |
