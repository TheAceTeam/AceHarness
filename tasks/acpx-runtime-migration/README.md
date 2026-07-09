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
- [Task 11: Legacy Removal And Dependency Pruning](11-legacy-removal.md)
- [Task 12: Verification, Scripts, And Migration Checks](12-verification-scripts.md)

## Current Judgment

- The repo is already on TanStack Start/Router/Query/DB/Virtual, so the migration should extend existing query keys and client collections instead of adding a parallel frontend state layer.
- `src/lib/engines` still contains the old wrapper boundary and must not be imported by new runtime core.
- `next.config.js` is already deleted in the worktree before this task list; this task list does not depend on restoring it.
- The migration is intentionally breaking. Compatibility belongs only in migration tooling and temporary shims.

## Overview

| Progress | Task | Status | Notes |
|----------|------|--------|-------|
| 100% | Task 1: Runtime Contracts And Package Boundary | Done | Runtime contracts added and targeted tests passed. |
| 45% | Task 2: SQLite Runtime Schema And Stores | In Progress | Runtime schema/store skeleton added; full heartbeat/cancel finalize remains later. |
| 45% | Task 3: Agent Registry And Icons | In Progress | Builtin registry and icon policy added; SQLite/API/UI consumption remains later. |
| 45% | Task 4: Model Routes SQLite Migration | In Progress | Model route schema/resolver/YAML seed skeleton added; API/UI migration remains. |
| 45% | Task 5: Permission, Env, And Secret Profiles | In Progress | Permission/redaction/env-secret helpers added; store/orchestrator integration remains. |
| 70% | Task 6: Runtime Adapters For acpx And Magic | In Progress | Adapter skeleton aligned with installed `acpx@0.12.0` exports; real execution wiring remains. |
| 10% | Task 7: Runtime Orchestrator, Queue, And Session Graph | In Progress | Assigned to subagent for orchestrator skeleton. |
| 10% | Task 8: Runtime API Routes And Streaming | In Progress | Assigned to subagent for runtime route skeleton. |
| 45% | Task 9: TanStack Client State Layer | In Progress | Runtime query keys and client collections added; live API/SSE integration remains. |
| 0% | Task 10: UI Migration For Engines, Models, Chat, Settings | Pending | Must preserve existing IA and components. |
| 0% | Task 11: Legacy Removal And Dependency Pruning | Pending | Must wait until runtime consumers are migrated. |
| 30% | Task 12: Verification, Scripts, And Migration Checks | In Progress | TypeScript baseline and runtime target tests are green; check scripts still pending. |
