# Current Verification Gaps

Updated: 2026-08-01 15:51:26 +08:00

## Closed In This Tasklist

- Task 7 Workbench dynamic-import verification has archived acceptance evidence; the SSR startup/module-loading blocker was user-confirmed resolved on 2026-08-01.
- Task 11 retained AI-guided creation entry/session/payload verification has archived focused evidence; current end-to-end acceptance is reopened under Task 16.
- Task 13 normal failed-step gating, explicit rerun/force recovery, active-history live synchronization, cleanup response filtering, and superseded-attempt audit retention have archived acceptance evidence (`11 files / 225 passed`, `npx tsc --noEmit` passed). Current revalidation is pending; Linux process-tree integration remains open.
- Task 8 Git-baseline-disabled application behavior has archived acceptance evidence. Disabled isolated-copy excludes `.git` directories and worktree `.git` files; enabled baseline remains compatible; rerun reloads current configuration and clears stale `workspaceGit`. Focused evidence is `2 files / 131 passed`, TypeScript passed, and the real temporary-directory copy probe passed. The 2026-08-01 current static reconciliation corrected stale AI-entry/tasklist wording and is awaiting coordinator acceptance.
- Task 14 ACPX tool-result recovery and live output have partial focused evidence (`3 files / 64 tests`). Shared ACPX terminal payload fields now survive adapter normalization and shared projection, but Task 35 now tracks the user-reproduced private orchestration-call classification gap. The TypeScript/browser/full-suite gate remains pending.
- Task 15 homepage invalid-model send failure visibility has current focused evidence (`4 files / 33 tests`). Both ordinary and streaming endpoints reject invalid selected routes before context/stream registration; the shared TypeScript/browser/full-suite gate remains pending.
- Task 27 dedicated lightweight task board and two-column tasklist documents have current focused evidence (`6 files / 15 tests`). The board derives primary/child activity, task relationships, and progress from run/tasklist evidence; state-machine layout remains covered by focused non-regression tests.
- Task 28 lightweight overview observability is accepted with focused evidence (`2 files / 5 tests`) and a clean TypeScript gate. The fresh full Task 10 gate remains required after this source change.
- Task 29 TypeScript gate repair is accepted with focused evidence (`2 files / 5 tests`) and a clean TypeScript gate. The fresh full Task 10 gate remains required after this source change.
- Task 30 lightweight preparation presentation is closed: the overview keeps Token consumption and uses only the live phase/step location while preparing; no persistent Skills/Git cards remain.
- Task 31 full-gate regression repair is in review: focused recommendation/model-selection repairs and TypeScript passed; the complete gate still needs to run.
- The coordinator gate listed below is historical; it is not a current acceptance result for the dirty worktree.

## Remaining Follow-ups

- **ACPX opaque subagent tool classification (Task 35):** a live ACPX session still displays provider-private `spawnAgent`/`wait` as `other`, which also prevents the lightweight task board from showing child-Agent evidence. Normalize the persisted ToolUse name, call identity, and raw input before runtime projection; add dispatch/wait running-to-terminal regressions and an evidence assertion. No UI-only/Codex-only fallback is acceptable.

- **AI-guided recovery and phase-mode removal:** selector/modal/page/create focused coverage is current (`4 files / 28 tests`) and phase/linear user-facing/configuration content is removed. Browser-smoke the UI planning entry's radio selection, no-empty-session behavior, multi-step planning continuation, and confirmed lightweight/state-machine creation.

- **Lightweight preparation alignment (Task 30):** accepted. The overview keeps Token consumption while `preparing` uses the current phase/step location and terminal runs contain no persistent Skills/Git preparation cards.

- **Full-gate regression repair (Task 31):** focused recommendation/model-loading regressions pass; rerun the complete Task 10 gate before release acceptance.

- **Current full gate:** the recorded `163 files / 1077 passed / 6 skipped`, component `30 files / 137 tests`, Playwright `5/5`, and TypeScript results are historical until rerun against the current worktree after Task 16 and remaining implementation/review work close.

- **Live ACPX Linux process-tree integration:** WSL2 now proves the production Linux process-manager path with two real isolated parent/child trees (`1/1`), including target-only cleanup. A live ACPX provider session/CLI was unavailable there, so repeat the same proof with a real ACPX parent/child process tree before claiming provider-level coverage.
- **ACPX all-process lifecycle and real tracing:** establish a reproducible matrix for every ACPX-routed process type covering start, streaming, stop, crash cleanup, and backend-visible diagnostics. Detailed lifecycle diagnostics remain backend-visible only.
- **ACPX Git self-behavior:** Task 8 repairs ACEHarness-owned isolated-copy and Git-baseline paths only. ACPX itself may stat or access `.git` for session discovery; capture a real OpenCode/ACPX filesystem trace with Git baseline/change tracking disabled before making any broader CPU/IO claim.
- **Configuration-change recovery regressions:** add direct regression coverage for baseline configuration changing to disabled before `resume` and before a stopped-run `force jump`. The implementation refreshes the gate in these paths, but Task 8's direct regression covers rerun-after-disable.
- **Windows test-worker contention:** unconstrained Vitest workers can contend for temporary directories and SQLite during the full suite, causing unrelated timeout clusters. The reproducible current functional gate uses `--maxWorkers=1`; this is test-infrastructure work, not a product behavior failure.

## Task 10 Gate (Historical)

The archived Task 10 gate passed at `100%`, and the archived coordinator gate after Tasks 14/15 passed: `npm test -- --maxWorkers=1` `163 files / 1077 passed / 6 skipped`, `npm run test:components` `30 files / 137 passed`, `npm run test:e2e` `5 passed`, and `npx tsc --noEmit` passed. E2E used the production Start app. `Scheduler restore skipped` is a non-failure runtime notice. Task 10 is **Blocked pending a fresh gate** for the current worktree.
