# Task 11: Legacy Removal And Dependency Pruning

Progress: 0%
Status: Pending

## Goal

Delete old wrappers, SDK drivers, legacy engine APIs, and dependencies after runtime consumers are migrated.

## Current State

- `src/lib/engines` contains old wrappers and SDK paths.
- `package.json` still includes multiple SDK dependencies.
- `next.config.js` is already deleted in the worktree for unrelated reasons and must not be restored by this task.

## Follow-Up Work

- Remove old wrapper files once no runtime consumer imports them.
- Remove old `/api/engine` routes after new APIs and migration paths are in place.
- Remove SDK dependencies no longer needed after acpx/Magic migration.
- Remove or rewrite old engine tests.
- Add static checks preventing reintroduction of `Engine`, SDK driver, stdio driver, and `backendSessionId` in runtime code.

## Acceptance

- No new runtime production code imports `src/lib/engines`.
- SDK dependencies for removed drivers are pruned from `package.json` and lockfile.
- `/api/engine` is absent or clearly migration-only with deletion tracked.
- Static scan and tests prove old driver UI/config paths are gone.

## Verification Record

- Not run yet.
