# Task 6: Scope Engine Availability Refreshes

Status: Complete

## Execution Contract

- Depends on: Task 2
- Unlocks: Task 5
- Execution: Parallel wave 2
- Delegated owner: Child agent, engine-page implementer
- Scope boundary: Own `src/client/query/engines.ts`, `src/client/pages/EnginesPage.tsx`, and focused client tests. Do not change the availability API route or ACPX consumers.

## Goal

Check all engines once when the Engines page mounts, then make each subsequent card-level check request only that engine.

## Current State

- `useEngineAvailabilityReportsQuery` fans every fetch out to all runtime engine IDs.
- Each card's `刷新状态` button calls the same full refresh path, so clicking one card probes every CLI.

## Follow-Up Work

- Completed: the reports query uses `refetchOnMount: 'always'` to preserve one full availability sweep on each page mount without creating per-mount cache keys.
- Completed: the refresh mutation accepts one engine and merges only that report into cached availability results.
- Completed: card and setup-drawer refresh actions target their own/current engine; the global header refresh action is removed.
- Completed: focused tests lock normalized single-engine request URLs and non-destructive cache merging.

## Acceptance

- Initial mount requests each supported engine once.
- Clicking an engine's availability action requests exactly `/api/engine/availability?engine=<that-engine>&refresh=1` and does not probe other engines.
- A failed single-engine refresh updates only that engine's report and preserves prior reports for all others.

## Verification Record

- Passed: focused client availability tests and the full Vitest suite.
