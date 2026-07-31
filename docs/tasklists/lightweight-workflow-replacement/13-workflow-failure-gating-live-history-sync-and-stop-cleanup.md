# Task 13: Workflow Failure Gating, Live History Sync, And Stop Cleanup

Updated: 2026-07-30 16:43:47 +08:00

## Goal

Make runtime control flow truthful and recoverable: a genuine failed step remains a retryable checkpoint, active run history stays live, and stopping a run reaps only its own ACPX process tree without exposing backend diagnostics in the UI.

## Design Locks

- A true step exception does not become a transition-eligible business verdict.
- Ordinary `resume` retries the recorded failed step. Explicit `rerun-from-step` and force-transition/jump operations remain available as deliberate recovery/operator actions and must not be invoked implicitly by ordinary progression.
- A known active `runId`, including one opened with `history=1`, keeps status and event synchronization alive.
- Process cleanup must be run-scoped and fail closed. It may not use a broad directory sweep as a substitute for missing attribution.
- ACP session resolution and zero-match explanations are diagnostic logs only; frontend progress uses only product-level stages and results.

## Parallel Work

### 13A: Run-Scoped ACPX Cleanup And Diagnostic Boundary

Owner: child agent `Boyle`
Scope: `src/server/api-routes/workflow/stop/route.ts`, `src/lib/core/process-manager.ts`, direct stop/process-manager tests.

Acceptance criteria:

- A target run's recorded ACPX roots and descendants are stopped when process attribution is available.
- Missing session metadata does not cause a workspace-wide or machine-wide sweep.
- The API/frontend-visible step list contains no raw ACP resolution, filter, or zero-match diagnostics.
- Internal diagnostics remain queryable from backend logs.

Coordinator review correction in progress:

- Child-run state loading must use the route's safe read boundary so one unreadable/missing child cannot abort cleanup already proven for its parent.
- A recursively scoped active non-detached child must be stopped coherently: do not merely kill its ACPX process while leaving a live manager or persisted `running`/`preparing` state behind.
- Detached, abandoned, inactive, missing, and conflicting-parent child records remain excluded from all stop and persistence changes.

Verification reviewed by coordinator:

- Exact target ACP records remain eligible on both platforms despite a closed record, CWD rewrite, reparented wrapper, or maintenance age; record ID, live PID, and start-time identity stay mandatory.
- Windows uses a native WMI/PowerShell process-table snapshot; Linux continues to use a locale-pinned `ps` snapshot. Both expand and signal only the exact root's descendants.
- Manager stop rejection/timeout no longer prevents captured exact cleanup. Internal mapping/zero-match diagnostics are backend logs, not API progress steps or Workbench text.
- Recursive scope includes only active, non-detached, non-conflicting child/descendant records. It uses a safe read boundary, cycle protection, and a 64-run cap; selected child managers are best-effort stopped and their persisted states become `stopped`.
- Child-agent verification: `npx vitest run tests/process-manager.test.ts tests/api-workflow-stop-route.test.ts` reported `46` passing; `npx tsc --noEmit` passed; targeted `git diff --check` passed with CRLF warnings only.

### 13B: Failure Checkpoint And Transition Gate

Owner: child agent `Banach`
Scope: `src/lib/state-machine/workflow-manager.ts`, directly related transition API logic and manager tests.

Acceptance criteria:

- A real execution exception stops the current attempt at the failed checkpoint without a downstream or bogus self-transition.
- Circuit-breaker logic never falls through to an arbitrary non-current state after failure.
- `resume` retries the failed step and normal state-machine transitions resume only after success.
- Ordinary progression and ordinary resume cannot silently invoke force transition/jump while unresolved failed steps exist; explicit recovery/operator requests remain supported.

Verification reviewed by coordinator:

- A true serial or parallel step exception records the failed step and aborts state-transition evaluation before any downstream or circuit-breaker route can be applied.
- `resume` continues from the recorded failed step. The current manager/API checks that reject force transition/jump while the checkpoint is unresolved must be revisited by 13F: the user requires those explicit recovery/operator primitives to remain available, while ordinary progression remains gated.
- Circuit breaking selects only an explicit alternative matching the current verdict and emits its transition with the original source state.
- `queryAgent` now passes the active run ID through runtime/process registration so its ACPX work is attributable to the run.
- Child-agent verification: `npx vitest run tests/state-machine-workflow-manager.test.ts tests/api-workflow-recovery-routes.test.ts` reported `120/120` passing; `npx tsc --noEmit` passed.

### 13C: Live History Synchronization And Progress Rendering

Owner: child agent `Descartes`
Scope: `src/client/pages/workbench/WorkbenchClient.tsx`, needed client API/helpers, direct Workbench tests.

Acceptance criteria:

- A `history=1` view for an active explicitly named run receives scoped status/event updates without reload.
- State graph, overview, and real-time output reconcile from the same run event sequence.
- UI defensively hides implementation-level cleanup diagnostics even if an older backend emits them.

Verification reviewed by coordinator:

- `WorkbenchClient.tsx` now enables compact status queries, scoped polling, scoped status SSE, and event-log reconciliation for an explicit history `runId`; the global stream remains disabled for that view.
- User-visible stop progress is normalized to fixed lifecycle phases and removes backend detail text and unrecognized ACP/session steps.
- Agent-reported focused Vitest result: `4/4` passing in `tests/workbench-history-live-sync.test.ts`. The agent reports lint had no errors. Full TypeScript is deferred because concurrent Task 13B edits were incomplete at that time.

### 13D: Cross-Platform ACPX Stop-Eligibility Audit

Owner: child agent `Turing`
Scope: read-only review of the run ID to ACPX process-tree chain on Windows and Linux.

Acceptance criteria:

- Identify every no-op guard between target `runId`, runtime-session persistence, ACP record mapping, recorded pid identity, and descendant termination.
- Establish whether Linux can silently skip a legitimately live agent because any mapping is unavailable or stale.
- Recommend only run-isolated corrections and regression cases; the 13A owner applies any code change.

Verification reviewed by coordinator:

- Linux has an implementation for process-tree signaling, but the target may still silently produce zero roots after any failed link in `runId -> runtime session -> ACP record -> pid/start identity -> process tree`.
- The current correction must preserve the captured exact run scope even when cooperative `manager.stop()` times out or fails, and it must not make `closed`, CWD string equality, current server ancestry, or maintenance-file age a hard exclusion once the record ID, PID, and start identity prove ownership.
- ACPX one-shot records require `record.name` as a candidate identifier in addition to filename/session fields.
- Long-lived detached descendants need a later ownership primitive such as an explicit child PID list, cgroup/pidfd, or Windows Job Object; no directory-wide fallback is allowed.

### 13F: Close Recovery-Entry Failure Bypass

Owner: reassigned child agent
Scope: `rerun-from-step`, force-transition/jump, and resume routes; `WorkflowManager` recovery methods; Workbench recovery handlers; and direct regression tests.

Acceptance criteria:

- Keep explicit `rerun-from-step` and force-transition operations available as deliberate recovery/operator tools; do not globally disable or narrow the foundational manager APIs merely because `failedSteps` is nonempty.
- Ordinary workflow progression and ordinary resume must not silently invoke either explicit recovery operation to bypass an unresolved failed checkpoint. Ordinary resume retries the failed checkpoint by default.
- Enforce the normal-versus-explicit recovery boundary at the relevant caller/route/UI layer, including persisted stopped runs with no in-memory manager.
- Audit adjacent rerun/recovery endpoints for equivalent implicit bypasses and add regression coverage distinguishing normal progression from an explicit recovery action.
- Make the rerun parameter contract unambiguous and end-to-end consistent: callers, route schema, manager lookup, and tests must agree whether the target is a state name or a step key.
- Do not report an asynchronous rerun as successful while silently swallowing a failed launch. Preserve asynchronous execution where required, but surface launch acceptance/rejection truthfully and audit only an accepted request.

### 13G: Make Explicit Recovery Truthful And Reachable

Owner: reassigned child agent
Scope: explicit in-flight force-transition handling, `StateMachineExecutionView`/Workbench rerun binding, and focused regressions.

Acceptance criteria:

- An explicitly accepted force transition remains effective if the concurrently active step subsequently reports a genuine failure; normal unforced failure behavior remains blocked at its checkpoint.
- `rerun-from-step` is reachable through a deliberate Workbench action, passes the canonical step key, and retains its confirmation plus acceptance-first local update behavior.
- Regression coverage distinguishes an explicit in-flight force action from ordinary automatic transition behavior and proves the Workbench action is wired rather than a dead handler.

### 13H: Retain Rerun Attempt Audit History

Owner: reassigned child agent
Scope: persisted step-log handling in explicit rerun, current-attempt materialization, and direct manager/API regressions.

Acceptance criteria:

- An explicit rerun retains necessary previous completed/failed step-attempt logs for backend audit and history.
- Historical attempt logs do not reintroduce `failedSteps`, block the new rerun, or appear as the new attempt's active materialized result.
- The retained history distinguishes a prior attempt from the new execution clearly enough for backend inspection and future UI/API readers.

## Dependencies

- 13A, 13B, 13C, and the read-only 13D audit run in parallel.
- Task 8 static audit and Task 10 full-suite gate are reopened only after all three child-agent handoffs are reviewed.

## Verification Record

- 13C reviewed and accepted as focused evidence; see its section above.
- 13D reviewed and converted into required 13A corrections; see its section above.
- 13B reviewed and accepted as focused evidence; see its section above.
- 13A reviewed and accepted as focused evidence; combined independent verification remains pending.
- 13E independent verifier reported `168/168` focused tests and TypeScript pass, but identified that the upper layer can treat explicit `rerun-from-step` recovery as ordinary failure progression. The user confirmed that explicit `rerun-from-step` and force transition are supported capabilities; 13F now corrects their caller boundary before rerunning 13E.
- 13F read-only independent audit found no automatic normal-flow call to `rerun-from-step` or force transition. It instead found: explicit force recovery is currently rejected under unresolved failures; rerun callers send `stepName` while the manager resolves `stateName`; the rerun route suppresses async launch errors before returning/auditing success; and the Workbench force action temporarily clears failure state before API success. The implementation agent is correcting these concrete issues and adding route/manager/UI regressions.
- 13F implementation handoff is under fresh independent verification: explicit force jump/transition is restored as a dedicated operator recovery path; ordinary `/resume` rejects force-transition input and retains failed-step retry semantics; rerun accepts `stepName` consistently and waits for background launch acceptance; Workbench updates recovery status/results only after acceptance; non-state-machine resume keeps its legacy branch. Focused implementation evidence is `3 files / 124 passed`, then the UI/phase follow-up is `2 files / 13 passed`; TypeScript passed in both runs. The coordinator reviewed the actual source and requested fresh five-file verification before acceptance.
- Fresh 13E verification ran `tests/workbench-history-live-sync.test.ts`, `tests/state-machine-workflow-manager.test.ts`, `tests/api-workflow-recovery-routes.test.ts`, `tests/process-manager.test.ts`, and `tests/api-workflow-stop-route.test.ts`: `5 files / 173 passed`; `npx tsc --noEmit` passed. It rejected acceptance because `assertStateCanTransition` clears an explicitly pending force target when the active step fails, and because `handleRerunFromStep` is not connected to a user-facing Workbench action. 13G is required before rerunning independent verification.
- 13G implementation handoff: `forceTransition()` now marks an explicit operator intent, so the checkpoint gate permits only that explicit override while retaining ordinary failure blocking. The final-state branch now consumes the target and records a forced `final -> target` transition instead of silently completing. `StateMachineDiagram` provides a tooltip-backed rerun icon for completed/failed steps while not running, `StateMachineExecutionView` forwards it, and `WorkbenchClient` binds it to the existing confirmation and acceptance-first launch flow. Focused implementation evidence: `5 files / 140 passed`, then final-state follow-up `2 files / 126 passed`; TypeScript passed. Fresh independent seven-file verification is running.
- Fresh 13G verification ran the original five Task 13 suites plus `tests/state-machine-diagram-step-matching.test.ts` and `tests/components/SubworkflowUi.test.tsx`: `7 files / 188 passed`; `npx tsc --noEmit` passed. It accepted the force and UI behavior but rejected closure because `rerunFromStep` filters replay-path `stepLogs`, deleting old completed/failed attempt logs while comments claim they remain available. 13H is required before the final rerun.
- 13H implementation handoff: replay-path logs are retained and marked `superseded` with `supersededAt`/`supersededByStep`; `deriveFailedStepKeys`, latest-log lookup, resume checkpoint selection, child output selection, and Workbench current-result hydration exclude superseded records. Persistence event snapshots, compact live status, and API client types retain the metadata. Focused implementation evidence: `tests/state-machine-workflow-manager.test.ts`, `tests/workflow-live-status.test.ts`, `tests/workbench-history-live-sync.test.ts`, and `tests/run-state-persistence.test.ts` reported `4 files / 156 passed`; TypeScript passed. Final independent 11-file verification is running.
- Final independent acceptance passed `11 files / 225 tests`: the original Task 13 runtime, recovery, Workbench, process-cleanup, diagram/UI, persistence, live-status, and run detail/output suites all passed. `npx tsc --noEmit` passed. Accepted semantics: normal failure stays checkpoint-gated; normal resume retries it; explicit force remains an intentional override including in-flight and final-state races; explicit rerun is reachable in the Workbench; old rerun attempts are retained as `superseded` backend-visible records without becoming current results or failures; history views stay live; ACPX cleanup stays strictly run-scoped and hides backend diagnostics from product progress. Real Linux process-tree execution remains an environment-specific integration-test gap on this Windows host, with no failing regression identified.
