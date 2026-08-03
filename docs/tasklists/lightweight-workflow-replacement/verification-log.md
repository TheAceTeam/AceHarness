# Recent Verification

Updated: 2026-08-01 15:51:26 +08:00

## 2026-08-01 15:51:00 Tasks 30 And 31 Coordinator Update

- Task 30 is accepted: lightweight overview no longer renders persistent Skills/Git preparation cards; its shared live location now includes both phase and step during preparation and removes duplicated state prefixes from internal step keys. `npx vitest run tests/workbench-lightweight-overview-observability.test.ts --reporter verbose` passed `1 file / 2 tests`; `npx tsc --noEmit --pretty false` passed.
- Task 31 child repair is in review: recommendation and model-selector focused regressions passed, and TypeScript passed. The complete Task 10 gate has not yet been rerun.

## 2026-08-01 15:25:00 Task 10 Fresh Gate Failure

- Scope: complete gate after Tasks 28 and 29.
- Result: `npm test -- --maxWorkers=1` failed after `503.89s`: `2 failed | 171 passed | 1 skipped`, `2 failed | 1120 passed | 7 skipped`. The two failures are `config-recommendations` unexpectedly returning `code-hunter` and `model-select` staying disabled in `loading`. Components passed `34 files / 159 tests`, TypeScript passed, and E2E passed `5/5`.
- Follow-up: Task 30 corrects lightweight preparation presentation; Task 31 diagnoses and repairs both full-suite failures. The gate must rerun after both.

## 2026-08-01 15:10:00 Tasks 28 And 29 Focused Acceptance

- Scope: lightweight overview observability and the concrete TypeScript residuals found by the pre-Task-28 gate.
- Evidence: lightweight overview now uses existing token analytics, runtime events/configured Skills, and workspace Git state to present Token consumption plus Skills/Git preparation evidence without fabricating unavailable values. Catalog/document/API type repairs preserve their existing domain contracts.
- Verification: `npx vitest run tests/workbench-lightweight-overview-observability.test.ts tests/agent-catalog.test.ts` passed `2 files / 5 tests`; `npx tsc --noEmit` passed; scoped `git diff --check` passed with line-ending warnings only.
- Result: Tasks 28 and 29 are **Done** at `100%`; Task 10 proceeds with a fresh full rerun.

## 2026-08-01 14:56:00 Task 10 Pre-Task-28 Gate

- Scope: current worktree release-gate attempt before the lightweight overview repair.
- Result: `npm run test:components` passed `34 files / 159 tests`; `npm run test:e2e` passed `5/5`. `npm test -- --maxWorkers=1` exceeded the 124 s command limit without a final summary. `npx tsc --noEmit` reported ten errors.
- Follow-up: Task 28 owns the Workbench error and the requested overview recovery. Task 29 owns the remaining catalog, document-panel/API, agent-chat route, and test-helper type errors. The gate must rerun after both tasks; this partial result is not release evidence.

## 2026-08-01 14:30:26 Task 8 Current Static Reconciliation

- Scope: post-Task-27 static audit of the lightweight creation contract, retained AI entry paths, phase-mode removal, run-owned tasklist metadata, and tasklist status/dependency consistency. No product source or tasklist README was edited.
- Evidence: the target creation source scan found no `phase-based`, `workflow.phases`, `workflow?.phases`, `阶段模式`, or `线性流程` matches. The target creation sources contain no `tasklistDirectory` or `docs/tasklists` references; focused tests retain only negative legacy-input assertions. `src/plugins/create-workflow` and `src/plugins/workflow-monitor` are absent. Task 27 is accepted and `implementation-order.md` records `Task 27 -> Task 08`.
- Contract correction: retained entry paths lead to the UI-only `ai-guided` journey, which may confirm either `lightweight` or `state-machine`; persisted `ai-guided` and `phase-based` modes remain rejected. The lightweight tasklist directory is run-owned runtime metadata, not configuration/create-form metadata.
- Result: Task 8 is **In Review** pending coordinator acceptance of this static reconciliation. Task 16 browser journey evidence and Task 10's fresh full gate remain separately owned gaps.

## 2026-08-01 14:27:00 Task 27 Lightweight Runtime Task Board Accepted

- Scope: a dedicated lightweight-run task board and two-column tasklist document view.
- Evidence: lightweight overview and Agent sections now render primary Agent plus actual child-Agent activity, task ownership/current work, serial/parallel grouping, dependencies, and evidence-backed completion. Tasklist documents lock to their run-owned source and hide the third generic folder/metadata column; state-machine views retain their normal formation and document layout.
- Verification: `npx vitest run tests/components/LightweightTaskBoard.test.tsx tests/components/lightweight-tasklist-evidence.test.ts tests/components/DocumentsPanel.layout.test.ts tests/components/DocumentsPanel.source-tabs.test.tsx` passed `4 files / 11 tests`; `npx vitest run tests/workbench-dynamic-import.test.ts tests/task8-config-documents.test.ts` passed `2 files / 4 tests`; scoped `git diff --check` passed with line-ending warnings only.
- Result: Task 27 is **Done** at `100%`. The remaining shared static audit and full gate are tracked by Tasks 8 and 10.

## 2026-08-01 16:51:00 Task 13 WSL Linux Process-Tree Integration

- Scope: production Linux process-manager record filtering, `ps` child-tree expansion, and signal isolation.
- Evidence: WSL2 Ubuntu 24.04 ran `node node_modules/vitest/vitest.mjs run tests/process-manager.linux-process-tree.integration.test.ts --reporter=verbose`; it terminated only target parent/child PIDs `914233/914247` and preserved other-run PIDs `914234/914248` (`1/1` passed).
- Boundary: ACP-shaped records and real OS processes prove the production Linux cleanup path. No live ACPX provider session was available in WSL, so this is not claimed as an ACPX-agent integration result.

## 2026-08-01 16:46:00 Task 16 Phase-Removal Cleanup Reviewed

- Scope: residual user-facing/configuration phase-mode content after the AI creation recovery.
- Evidence: `NewConfigModal` now maps displays only to `轻量工作流` or `状态机`; `configs/README.md` contains the current lightweight/state-machine and step-Skills contracts. `npx vitest run tests/components/NewConfigModal.test.tsx tests/components/WorkflowModeSelector.test.tsx tests/components/WorkflowsPage.test.tsx tests/api-configs-create.test.ts` passed `4 files / 28 tests`.
- Result: Task 16 is **In Review** at `95%`; browser journey evidence and the shared final gate remain.

## 2026-08-01 16:42:00 Task 27 Phase A Accepted

- Scope: isolated lightweight task-board evidence adapter and component, with no Workbench or DocumentsPanel integration edits.
- Evidence: `npx vitest run tests/components/LightweightTaskBoard.test.tsx` passed `1 file / 5 tests`; coordinator review added the guard that excludes bare/idle ordinary roster entries from child-Agent activity.
- Result: Phase A accepted. Phase B is active for live tasklist parsing, lightweight Workbench/Agent integration, and two-column document layout.

## 2026-08-01 16:38:00 Task 13 Current Runtime Revalidation

- Scope: failure checkpoints, explicit recovery, run-scoped cleanup, live history, and status isolation.
- Finding and repair: both normal and compact scoped status endpoints now return target-scoped idle/not-found data when the requested run record is absent, rather than falling back to a same-config manager from another run.
- Verification: `npx vitest run tests/state-machine-workflow-manager.test.ts tests/api-workflow-recovery-routes.test.ts tests/workbench-history-live-sync.test.ts tests/api-workflow-status-route.test.ts tests/process-manager.test.ts tests/api-workflow-stop-route.test.ts` passed `6 files / 192 tests`; scoped `git diff --check` passed with only line-ending warnings.
- Result: Task 13 is **In Review** at `99%`; a real Linux ACPX process-tree integration and shared final gate remain open.

## 2026-08-01 16:31:00 Task 19 Lightweight Authoring Review

- Scope: lightweight direct-create controls and current run-owned tasklist creation contract.
- Evidence: `npx vitest run tests/components/NewConfigModal.test.tsx` passed `1 file / 11 tests`; coordinator source review confirms a synchronous re-entry guard, unified loading state, disabled Agent/goal/button controls, and no leaked tasklist path or step-Skills field.
- Result: Task 19 is **In Review** at `95%`; browser confirmation and shared final gate remain outstanding.

## 2026-08-01 16:27:00 Task 16 Residual Phase-Mode Audit Finding

- Evidence: a broader user-facing/source scan found five `线性流程` fallback labels in `NewConfigModal.tsx` and a `configs/README.md` `phase-based` documentation section after the earlier identifier-only scan.
- Result: Task 16 is reopened at `85%` for bounded cleanup. Internal generic `specCoding.phases` data is not a phase-workflow regression and remains retained.

## 2026-08-01 16:20:00 Task 21 Runtime Tasklist Storage Accepted

- Scope: canonical run-owned tasklist path across creation, start, rehearsal, manager resume, state persistence, document roots, and AI workflow assembly.
- Verification: initial `6 files / 184 tests`, then post-review `7 files / 208 tests`. Tests prove no workspace `docs/tasklists` creation, source-aware runtime document reads, canonical resume, and fail-closed legacy resume/document metadata. Static source review found no remaining production workspace-directory reservation or fallback call.
- Result: Task 21 **Done** at `100%`; Task 27 is unblocked.

## 2026-08-01 16:14:00 Task 18 Workbench Header And Start-Run Review

- Scope: design-header rename and successful formal-start navigation.
- Evidence: `npx vitest run tests/workbench-history-live-sync.test.ts` passed `9/9`; coordinator reviewed immutable draft saving, save de-duplication, local history upsert, selection, and overview URL handoff.
- Result: Task 18 is **In Review** at `95%`; focused behavior is accepted and browser confirmation remains pending.

## 2026-08-01 16:10:00 Task 14 And Task 15 Corrective Reviews

- Task 14 scope: shared ACPX terminal tool-event normalization and structured result projection. Top-level `formatted_output`, `result`, `error`, and exit-code fields are now retained before projection; command/search output remains visible while file bodies remain suppressed. `npx vitest run tests/runtime-adapters.test.ts tests/workflow-runtime-model-route.test.ts tests/components/RuntimeToolEventList.test.tsx` passed `3 files / 64 tests`.
- Task 15 scope: selected global models without an active compatible runtime route. Shared validation now runs in both ordinary and streaming chat APIs before context/session/turn work; the client-visible error preserves retryability. `npx vitest run tests/chat-context.test.tsx tests/api-chat-runtime-model-route.test.ts tests/api-chat-route.test.ts tests/api-chat-stream-flow.test.ts` passed `4 files / 33 tests`.
- Result: both tasks remain **In Review** pending the current shared TypeScript/browser/full-suite gate; their focused implementation evidence is current.

## 2026-08-01 16:02:00 Task 16 And Task 20 Coordinator Review

- Scope: reviewed the completed child-agent slices for retained AI-guided creation and lightweight runtime navigation.
- Task 16 evidence: `tests/components/NewConfigModal.test.tsx` passed `10/10`; the creation-chain focused set passed `33/33`. Coordinator source review confirmed exclusive UI-only `ai-guided` selection, deferred chat-session creation, supported persisted modes only, and no active phase-mode source reference beyond negative regression assertions. Browser smoke remains open, so Task 16 is **In Review**.
- Task 20 evidence: `tests/components/DocumentsPanel.source-tabs.test.tsx` passed `1/1`; coordinator source review confirmed lightweight tasklist locking and state-machine non-regression in Workbench navigation. Task 20 is **Done** at `100%`.
- Result: Task 21 remains the active runtime-storage implementation. Task 27 is newly tracked for the dedicated lightweight task-board/Agent/document surface.

## 2026-08-01 13:09:10 Task 22 Lightweight Supervisor-Free Runtime Accepted

- Scope: Removed implicit `default-supervisor` behavior for lightweight workflows while retaining normal state-machine defaults.
- Verification: `tests/creator-validation.test.ts`, `tests/api-workflow-start-flow.test.ts`, and `tests/state-machine-workflow-manager.test.ts` passed `3 files / 168 tests`; scoped `git diff --check` passed with line-ending warnings only.
- Result: Task 22 **Done** at `100%`. Task 21 is unblocked.

## 2026-08-01 13:00:05 Task 26 Three-Second Trailing Tool-Group Hold Accepted

- Scope: Changed only the streaming terminal group stability duration from 1.2 seconds to 3 seconds.
- Verification: `npx vitest run tests/components/RuntimeToolEventList.test.tsx` passed `1 file / 7 tests`; coverage includes the 2.999-second boundary, next-tool reset, terminal close, and immediate stream-end close.
- Result: Task 26 **Done** at `100%`.

## 2026-08-01 13:00:05 SSR Startup And Module Loading Blocker Resolved

- Evidence: user confirmation that the prior SSR startup/module-loading issue is fixed.
- Result: remove this blocker from Tasks 5, 7, 10, and 16. This does not certify the remaining AI creation work or the final test gate.

## 2026-08-01 12:53:24 Task 26 Trailing Tool-Group Hold Adjustment

- Scope: User-selected UI timing change only.
- Required behavior: hold an otherwise terminal tool group open for 3 seconds while the response is streaming; a next tool resets the timer and the end of the stream closes immediately.
- Result: delegated implementation pending. No verification is claimed by this entry.

## 2026-08-01 12:45:51 Task 25 Workbench Tool-Group Identity Accepted

- Scope: Repaired trailing live tool-call group remounts and extended the streaming terminal stability window to 1.2 seconds.
- Changes: `WorkbenchClient.tsx` now gives a contiguous tool group a stable identity based on its first call. Terminal status changes and newly appended contiguous calls retain that identity; a non-tool boundary begins a new identity. Streaming end still closes the group immediately.
- Verification: `npx vitest run tests/components/RuntimeToolEventList.test.tsx` passed `1 file / 7 tests`; the scoped `git diff --check` passed with only line-ending warnings.
- Result: Task 25 **Done** at `100%`. Browser confirmation remains part of the shared Workbench gate, not a prerequisite for this focused correction.

## 2026-08-01 12:37:03 Task 25 Workbench Tool-Group Identity Triage

- Scope: Investigated user-observed expand/collapse flicker at the tail of contiguous live tool calls.
- Evidence: `RuntimeToolEventGroup` already has a streaming-only, resettable 400 ms terminal stability timer. In `WorkbenchClient.tsx`, the virtual-list key includes both the group index ending in the current last tool ID and a `pending`/`done` suffix. A terminal update or the next contiguous tool therefore remounts the group and loses that timer/state.
- Result: implementation delegated in the Workbench owner lane as Task 25. No completion or test result is claimed by this entry.

## 2026-07-31 18:50:23 Task 17 Default Tasklist Location And Viewer

- Scope: Removed tasklist-directory path displays from creation, design, and lightweight run overview surfaces; added source-aware tasklist document filtering and Workbench navigation.
- Evidence: Persisted lightweight metadata and the Agent runtime tasklist-directory instruction were left unchanged. `GET /api/runs/:id/documents?source=tasklist` now filters before pagination and the existing content endpoint remains source-aware.
- Focused verification: `npx vitest run tests/components/NewConfigModal.test.tsx tests/components/LightweightWorkflowDesignPanel.test.tsx tests/task8-config-documents.test.ts` passed `3 files / 12 tests`.
- Runtime probe: the active Vite server returned HTTP 200 for `/src/client/pages/workbench/WorkbenchClient.tsx`.
- TypeScript: `npx tsc --noEmit` reached the 120-second tool limit without diagnostics; no TypeScript pass is claimed from that attempt.
- Result: Task 17 **Done** at `100%`. The broader full-suite gate remains governed by Task 10 and the current README blockers.

## 2026-07-30 17:13:10 Final Task 8 And Task 10 Archive

- Status: Task 8 and Task 10 are **Done** at `100%`. Earlier entries that describe pending reruns, in-review status, or pre-fix failures remain historical context only; they do not describe the current gate state.
- Task 8 boundary: ACEHarness-owned isolated-copy and Git-baseline paths are accepted. With the baseline disabled, isolated copies exclude `.git` directories and worktree `.git` files; enabled-baseline compatibility and rerun configuration refresh are covered. This does **not** claim that ACPX itself never stats or otherwise accesses `.git`; ACPX process-level behavior remains a separate runtime-tracing follow-up.
- `npm test`: **pass**, `160 files / 1047 passed / 6 skipped`.
- `npm run test:components`: **pass**, `29 files / 132 passed`.
- `npm run test:e2e`: **pass**, `5 passed`. Port `5188` was clear before the run, `PLAYWRIGHT_BASE_URL` was unset, and Playwright used the current `dist` through `start:start`.
- `npx tsc --noEmit`: **pass**.
- `Scheduler restore skipped` was emitted as a non-failure scheduler restoration notice; it is neither a failed nor skipped test and does not affect release-gate acceptance.

## 2026-07-30 14:30:08 Final Inline UI Evidence Refresh

- Scope: Documentation-only refresh after the latest source-changing UI work was reviewed and verified. No source, test, or task-status files were changed by this sync.
- Current UI boundary: system CLI environment variables are inline in the `SystemSettingsContent` `environment` section through shared `EnvVarsEditor`; personal CLI environment variables remain in the global `EnvVarsDialog` modal.
- Current focused UI evidence: `npx vitest run tests/components/EnvVarsDialog.test.tsx --environment jsdom` passed `1 file / 3 passed`; `npm run test:components` passed `29 files / 131 passed`; `npx tsc --noEmit` passed.
- Current post-inline-UI gate: `npm test` passed `158 files / 1005 passed / 6 skipped / 0 failed`.
- Historical baseline: the prior `npm test` result `158 files / 1004 passed / 6 skipped / 0 failed` remains historical evidence only and is not the current post-inline-UI gate.

## 2026-07-30 14:06:21 Final Gate And Status Synchronization

- Scope: Documentation-only synchronization of the final gate and Task 12 status. No source or test files were changed by this sync.
- Final local gate: `npm test` passed `158 files / 1005 passed / 6 skipped / 0 failed`; the component gate passed `29 files / 131 passed`; `npx vitest run tests/components/EnvVarsDialog.test.tsx --environment jsdom` passed `1 file / 3 passed`; `npx tsc --noEmit` passed.
- UI boundary: system CLI environment variables remain directly inline in the `SystemSettingsContent` `environment` section through the shared `EnvVarsEditor`; personal CLI environment variables remain in the global `EnvVarsDialog` modal.
- Status: Task 12 is **Done** at `100%`. Task 8 and Task 11 remain **In Review** at `95%`.
- Historical baseline: the prior local `npm test` result `158 files / 1004 passed / 6 skipped / 0 failed` is retained as historical evidence and is not the current gate.

## 2026-07-30 13:57:29 Task 12 Inline System Environment Editor UI Sync

- Scope: Documentation-only synchronization of the latest settings UI change and verification output. No source or test files were changed by this sync.
- UI boundary: system CLI environment variables are now embedded directly in the `SystemSettingsContent` `environment` section through the shared `EnvVarsEditor` inline. The system dialog, edit button, and `systemEnvDialogOpen` state are no longer present. Personal CLI environment variables continue to use the global `EnvVarsDialog`.
- Focused UI evidence: `npx vitest run tests/components/EnvVarsDialog.test.tsx --environment jsdom` passed `1 file / 3 passed`.
- Component gate: `npm run test:components` passed `29 files / 131 passed`.
- TypeScript gate: `npx tsc --noEmit` passed.
- Result: Task 12 remains **Done** at `100%`. Task 8 and Task 11 statuses are unchanged; earlier verification entries below remain historical evidence.

## 2026-07-30 13:35:48 ACPX Environment Precedence Regression (Historical)

- Scope: Audited and repaired configured environment merging for ACPX session creation, reconnect, CLI process inheritance, and debug trace output.
- Changes: effective precedence is `personal > system > host`; an unset personal value uses the system value, and when system is also unset acpx inherits the host value. Empty, null, undefined, and disabled entries are ignored and cannot replace a valid lower-layer value. Startup and reconnect both reload the latest configured values. ACPX debug traces are redacted before persistence and remain backend-only diagnostics.
- Focused evidence: the final focused rerun passed `2 files / 36 tests`; the separate agent report passed the complete `3 files / 45 tests` coverage, including provider coverage, fallback behavior, reconnect updates, and trace redaction. `npx tsc --noEmit` passed.
- Matrix boundary: real `npm run check:runtime:chat -- --agent claude --model claude-sonnet-4-5 --json` completed ACPX spawn and ACP initialization, then failed at the expected CLI authentication requirement; OpenCode completed a real turn; Codex was blocked before an ACP turn by the host `~/.codex/config.toml` value `reasoning_effort=max`, which is incompatible with the installed CLI. This is not a claim that the four-CLI real matrix passed. The initial OpenCode probe using `runtime-check-model` was rejected by expected model capability validation.
- Runtime source audit: installed acpx `0.12.0` agent spawn builds `{ ...process.env, ...sessionEnv }`; terminal exec builds from the inherited process environment before applying explicit terminal env entries.
- Historical full gate: the prior local `npm test` passed `158 files / 1004 passed / 6 skipped / 0 failed`; `npx tsc --noEmit` passed. The earlier `1003 passed` result is retained below as historical evidence, and this `1004` result is not the current gate.
- Result: pass for application merge semantics and the observed Claude/OpenCode startup paths; the real four-CLI matrix remains incomplete because Claude stopped at authentication and Codex was host-config blocked. Full reconnect with a live provider remains represented by focused regression evidence.

## 2026-07-30 12:36:10 Final Documentation Synchronization (Historical)

- Scope: Synchronized the coordinator README, verification log, and verification gaps after the cleanup and final gate handoffs. No source files were changed by this documentation sync.
- Final status: Task 12 is **Done** at `100%`; the `12:26:16` pre-cleanup residual-UI findings are historical and closed by the `12:34:03` cleanup report.
- Historical evidence at that time: focused `37/37`; components `29 files / 129 passed / 0 failed / 0 skipped`; `npm test` `158 files / 999 passed / 0 failed / 6 skipped`; E2E `5 passed / 0 failed / 0 skipped`; TypeScript passed. These numbers are retained for history, not as the current gate.
- Deletion boundary remains: only the two unreferenced frontend Memory V2 UI files and the AccountPage avatar internal explanation were removed; backend `memory-v2` remains retained.

## 2026-07-30 12:34:03 Task 12 Final Cleanup And Gate Complete (Historical)

- Scope: Documentation-only synchronization of the cleanup completion report and final verification results. No source files were changed by this sync.
- Status: Task 12 is **Done** at `100%`.
- Historical focused verification: settings/env/runtime focused tests passed `37/37`.
- Final component gate: `npm run test:components` passed with `29 files / 129 passed / 0 failed / 0 skipped`.
- Historical npm gate: `npm test` passed with `158 files / 999 passed / 0 failed / 6 skipped`.
- Final browser gate: `npm run test:e2e` passed with `5 passed / 0 failed / 0 skipped`.
- TypeScript gate: `npx tsc --noEmit` passed.
- Cleanup boundary: deleted the two unreferenced frontend UI files `src/components/memory-v2/MemoryV2DiagnosticsPanel.tsx` and `src/components/memory-v2/MemoryV2GovernancePanel.tsx`; removed the internal avatar explanation from `src/client/pages/AccountPage.tsx`. Backend `memory-v2` implementation, data, and runtime compatibility remain retained.
- Static verification: both deleted UI paths are absent and no match remains for the specified avatar explanation or the removed governance copy. The settings and account route surfaces retain their required functionality.
- Backend compatibility: existing `/api/env` user/system scopes and permission checks remain unchanged; host values remain the fallback layer; ACPX receives merged variables on startup and reconnect; `process-manager.ts` has no separate ACPX injection point; detailed runtime and cleanup logs remain backend-visible.
- Remaining note: the broader cross-process ACPX runtime matrix remains a compatibility follow-up outside this completed settings/UI cleanup boundary; it does not imply removal of backend `memory-v2`.

## 2026-07-30 12:17:38 Task 12 Settings And CLI Environment Review (Historical)

- Scope: Documentation-only synchronization of the completed Task 12 implementation handoff. No source files were changed by this sync.
- Implemented settings changes: the system-settings Memory V2 frontend tab/UI is removed, and system CLI environment variables are available below personal variables.
- Implemented personal settings changes: personal environment variables open in a global Portal modal with Claude, Codex, OpenCode, and other CLI tabs; the password-change `ObjectEditDrawer` remains available.
- Implemented ACPX behavior: personal, system, and host variables merge in `personal > system > host` order; empty, undefined, or disabled entries do not replace a lower-layer effective value; merged variables are injected on agent startup and reconnect.
- Focused verification: `37/37` passed across the settings/env/runtime focused tests; `npx tsc --noEmit` passed.
- Status: Task 12 is **In Review** at `90%`, not Done. Final review requires the new full gate and runtime/copy verification after these source changes.
- Task 10 boundary: the previous `npm test` result (`156 files / 988 passed / 0 failed / 6 skipped`), component result (`127/127`), E2E result (`5/5`), and TypeScript/diff checks are retained as historical evidence. The configured full gate must be rerun after Task 12 changes; no current full-suite pass is claimed.

## 2026-07-30 12:26:16 Task 12 Static Audit And Final Gate Handoff (Pre-cleanup, Superseded)

- Scope: Documentation-only synchronization of the latest static audit and real verification handoffs. No source files were changed by this sync.
- Historical status: Task 12 was **In Review** at `90%` at this snapshot. This entry is superseded by the `12:34:03` cleanup-complete entry above.
- Static audit findings (historical, closed): `src/components/memory-v2/MemoryV2DiagnosticsPanel.tsx:149` and `src/components/memory-v2/MemoryV2GovernancePanel.tsx:361` still contained Memory V2 UI before cleanup. The audit found no current reference from system settings, account settings, or routes; both unreferenced UI files were deleted in the `12:34:03` cleanup.
- Static copy findings (historical, closed): `src/client/pages/AccountPage.tsx:401` contained `头像会用于个人菜单、协作和账户上下文。`; `src/components/memory-v2/MemoryV2GovernancePanel.tsx:474` contained `列表只展示索引、交接与审计元数据；详情仅在明确打开后按版本分页读取。`. The avatar explanation was removed and the governance UI file was deleted in the cleanup.
- Pre-cleanup real gate report: `npm run test:components` passed with `29 files / 129 passed / 0 failed / 0 skipped`; `npm test` passed with `158 files / 999 passed / 0 failed / 6 skipped`; `npm run test:e2e` passed with `5 passed / 0 failed / 0 skipped`; `npx tsc --noEmit` exited with code 0.
- Gate interpretation at this historical snapshot: these results were the green pre-cleanup gate. The required post-cleanup gate is recorded in the `12:34:03` completion entry above.
- Backend compatibility: the existing `/api/env` user/system scope and permission contract remains in place; host environment values remain the fallback layer. ACPX uses the merged environment at agent startup and reconnect, while `process-manager.ts` has no separate ACPX injection point. Detailed runtime and cleanup logs remain backend-visible.
- Closure rule at this historical snapshot: mark Task 12 `Done/100%` only after cleanup and the post-cleanup gates. This requirement was satisfied and is recorded in the `12:34:03` completion entry above.

## 2026-07-30 11:59:42 Historical Full Test And E2E Gates Passed

- Scope: Documentation-only synchronization of the latest verification results. No source files were changed by this sync.
- Historical full suite: `npm test` passed with `156 files / 988 passed / 0 failed / 6 skipped`.
- Component suite: `npm run test:components` passed with `127/127`.
- Browser suite: `npm run test:e2e` passed with `5/5` after the Playwright configuration fix.
- Repository checks: `npx tsc --noEmit` passed and `git diff --check` passed.
- Status at that time: Task 10 was recorded as `Done` at `100%` and Task 12 was `In Progress` at `5%`. This entry predates the Task 12 source changes and is retained only as historical evidence; the current Task 10 gate is pending rerun and Task 12 is `In Review` at `90%`.
- Historical snapshot: the retained `AI 引导创建` entry was described as part of the lightweight creation flow. The current contract supersedes that lightweight-only wording: it is a UI planning entry whose confirmed output may create lightweight or state-machine. No legacy phase workflow, old `/workflow` path, or persisted `ai-guided` mode is restored by this verification update.

## 2026-07-30 11:51:29 New Task 12 Requirements Recorded

- Scope: Documentation-only registration of the new settings, environment, ACPX CLI injection, and copy-cleanup work. No source files were changed by this sync.
- Status: Task 12 is `In Progress` at `5%`; the percentage represents requirements capture only. No implementation, test, or completion evidence is claimed.
- Required settings work: remove the Memory V2 tab/UI from system settings; add system-level environment-variable settings below personal environment variables; change personal environment settings to a global modal with a CLI tab; retain the password-change dialog.
- Required env behavior: for ACPX Claude, Codex, OpenCode, and other CLI process types, merge environment variables with precedence `personal > system > host`; an empty value must never overwrite an existing non-empty value.
- Required copy behavior: remove internal migration/audit wording and negative-facing text from user-visible surfaces; replace it with positive, friendly introductions. Internal diagnostics may remain backend-visible where required, but must not be presented as user-facing product copy.
- Verification boundary: focused UI, precedence/empty-value, provider-specific ACPX injection, password-dialog, and copy-scan tests still need to be assigned and run. This new task is independent of the prior full `npm test` gate and does not alter its `In Progress` status.

## 2026-07-30 11:42:36 AI Entry And Coordinator Status Refresh (Historical, Superseded)

- Scope: Documentation-only synchronization of the final AI-entry handoff report. No source files were changed by this sync.
- Historical AI entry snapshot: `WorkflowModeSelector.tsx` exposed the third `AI 引导创建` card; clicking it entered the lightweight `NewConfigModal` flow and created or reused the lightweight creation session. The current contract supersedes this lightweight-only wording: the UI planning entry may confirm lightweight or state-machine. `WorkflowsPage.tsx` and `ChatPageContent.tsx` are both connected. The retained entry does not restore a phase workflow, the old `create-workflow` plugin, `/workflow`, or a persisted `ai-guided` mode.
- AI-entry focused verification: `15/15` passing. The component suite is `127/127`, E2E is `5/5`, and TypeScript passes.
- Additional evidence retained: Workbench dynamic-import focused test `2/2`, Vite build success, TypeScript, clean server `5187`, and exact browser module import; ModelDiagnostics `16/16`; API/mock repair cluster `3/3`; workspace API `6 passed / 4 skipped`; Agora `18/18`; `WorkspaceDirectoryPicker` `1/1`; `AgentEditModal` `1/1`; Windows cleanup `3 files / 34 tests`; Git-baseline-disabled path `109/109` plus TypeScript; ACPX lifecycle focused evidence `76/76`.
- Status decision: Task 5 -> `In Review` (`95%`); Task 7 -> `In Review` (`95%`); Task 8 -> `In Review` (`95%`); Task 10 remains `In Progress` (`90%`); Task 11 -> `In Review` (`95%`). None of these tasks is marked `Done/100%`.
- Gate boundary: the full `npm test` command has not been rerun after the repairs. The earlier coordinator failure baseline remains historical evidence only; no full-suite pass is claimed. The remaining review items are the fresh full-suite run plus independent ACP/Git-baseline runtime confirmation.

## 2026-07-30 11:37:05 Focused Component Verification Update

- Scope: Documentation-only synchronization of newly reported focused test evidence. No source files were changed by this sync.
- ModelDiagnostics: the related 3-file focused set reports `16/16` passing; the previous `5/6` streaming-score gap is superseded by this result.
- Component suite: `126 passed`; 1 test remains failing in `NewConfigModal`, specifically the AI workflow-entry copy assertion.
- Workbench evidence retained: focused dynamic-import test `2/2`, Vite build success, TypeScript success, clean server `http://127.0.0.1:5187`, and exact browser module import success remain recorded in the 11:29:43 entry below.
- AI-entry status: the AI-entry agent's final completion report is still pending. Keep the retained AI creation entry, and append its final visible entry path/session result immediately when the agent reports; do not infer browser success from the earlier `4 files/32 tests + tsc` evidence.
- Result: Task 10 remains `In Progress`. The component-suite gate has one known `NewConfigModal` copy failure, and the full `npm test` and E2E gates have not been rerun. No full-suite success is claimed.
- Superseded by the 11:42:36 entry above: the later component result is `127/127`, the AI-entry focused result is `15/15`, and E2E is `5/5`; the full `npm test` gate is still pending.

## 2026-07-30 11:29:43 Workbench Dynamic-Import Verification

- Scope: Documentation-only synchronization of the completed Workbench dynamic-import repair handoff. No source files were changed by this sync.
- Focused test: `npx vitest run tests/workbench-dynamic-import.test.ts` completed with `2/2` passing.
- Build: `npx vite build -c vite.start.config.mts` succeeded with 8005 client modules and 970 SSR modules.
- TypeScript: `npx tsc --noEmit` passed.
- Clean server: `http://127.0.0.1:5187` returned `200` for `/login`, the Workbench route, and the exact module URL.
- Browser module check: `import('/src/client/pages/workbench/WorkbenchClient.tsx')` resolved successfully to a function; no `5xx` or `503` occurred.
- Result: **Workbench dynamic-import gap closed.** Task 7 is updated to `Done`; Task 8 remains `In Review` because the AI-entry browser/user-flow audit, the later `NewConfigModal` copy failure, ACP/runtime evidence, and full-suite gate remain open.

## 2026-07-30 11:25:44 Live Tasklist Sync

- Scope: Documentation-only synchronization requested after the latest focused repair reports. No source files were changed.
- Windows cleanup repair: `3 files / 34 tests passed`; this covers the SQLite lock and temporary-directory teardown fixes.
- Passing focused evidence: workspace API `6 passed / 4 skipped`; Agora `18/18`; `WorkspaceDirectoryPicker` `1/1`; and `AgentEditModal` `1/1`.
- Superseded by the 11:37:05 focused update: ModelDiagnostics-related tests now report `3 files / 16 passed`; the remaining component failure is the `NewConfigModal` AI-entry copy assertion.
- Still processing at this historical snapshot: the ModelDiagnostics repair and the AI workflow-creation entry visibility/call-path audit. The 11:37:05 update supersedes the component status; the AI entry must remain available and end in the lightweight creation UI/session.
- Superseded by the 11:29:43 Workbench verification below: the dynamic-import/browser smoke is now passed. The full test-suite gate is still not passed, and no full-suite success is claimed.
- UI scope lock: the original UI had `阶段模式`, `状态机模式`, and `AI 引导创建`. Only the `AI 引导创建` entry is to be restored; do not restore the phase-mode UI or persisted `ai-guided` mode. The lightweight workflow remains tasklist-driven for dynamic decomposition, scheduling, and acceptance.

## 2026-07-30 Focused Repair Evidence And Live Status

- Scope: Follow-up verification after the coordinator's `npm test` triage.
- Passing focused evidence: `tests/api-workspace-routes.test.ts` reports `6 passed, 4 skipped`; `tests/plugins/agora-chat-panel.test.tsx` reports `18/18`; `tests/components/WorkspaceDirectoryPicker.test.tsx` reports `1/1`; and `tests/components/AgentEditModal.test.tsx` reports `1/1`.
- Superseded focused evidence: the ModelDiagnostics-related 3-file set reports `16/16` passing. Keep the `NewConfigModal` AI-entry copy assertion open.
- API/mock delegation status: the repaired API/mock cluster reports `3/3` focused targets passing. The configured full suites still need a fresh run, so this does not close Task 10.
- AI-entry status: the retained AI workflow-creation implementation has focused evidence (`4 files/32 tests` and TypeScript success), while the user's report that the entry is not visible is being reproduced and audited. No browser/user-flow success is claimed yet.
- Gate status: these focused results do not replace the prior failed full-suite baseline. `npm test` must be rerun after the remaining repairs; `npm run test:components` and `npm run test:e2e` also remain pending.

## 2026-07-30 AI Entry Retention Audit

- Scope: Documentation-only audit of legacy phase/plugin removal and the required AI-guided workflow creation entry.
- Evidence: `Test-Path src/plugins/create-workflow` returned absent; `rg -n -i "phase-based|workflow\.phases|workflow\?\.phases" src tests` returned no matches; `QuickActions.tsx` contains the workflow guide and Codespec action; `ChatPageContent.tsx` contains `starterAction` handling for `create_agent` only; `WorkflowsPage.tsx` exposes generic `新建工作流` but no separate `AI 创建`; `NewConfigModal.tsx` and the config-create route contain the lightweight destination contract.
- Result: Partial. Legacy phase executor/plugin references are statically absent, but AI-entry retention is incomplete: the current code does not prove QuickActions, `starterAction`, and ordinary homepage conversation all reach a lightweight creation UI/session.
- Follow-up: Task 11 restores and verifies the three entry paths; Task 8 reviews the resulting static call graph.
- Superseded: **2026-07-30 Agent Verification Reports** below supersedes this interim audit for current AI-entry status; the historical evidence above is unchanged.

## 2026-07-30 Verification Boundaries

- Scope: Commands run while synchronizing this tasklist.
- Evidence: No source, README, build, lint, TypeScript, formatter, package-installation, full-test, or browser files were changed or run as part of this documentation update.
- Result: The Workbench dynamic-import report is superseded by the 11:29:43 focused/build/server/browser evidence. The historical full-suite aggregate remains a failure baseline and is not a pass.
- Follow-up: fix the `NewConfigModal` AI-entry copy assertion, append the AI-entry agent's final visible path/session result when available, then rerun the configured full suites and record exact output before changing the remaining tasks to Done.

## 2026-07-30 Scope And Feedback Record

- Product decisions recorded: retain the AI workflow-creation journey through QuickActions, `starterAction`, and ordinary homepage conversation; remove the legacy phase workflow and `create-workflow` plugin implementation; remove the frontend memory-handoff tab and Werewolf extension; keep detailed logs backend-visible and show only the necessary frontend summary.
- User feedback: after Git baseline and change tracking are disabled, starting an OpenCode workflow reportedly still performs Git backup work in the ACEHarness runtime directory and consumes substantial CPU. The same behavior may affect other process types routed through `acpx`.
- Result: **Open regression / not verified fixed**. No source or test was changed in this documentation-only update, and no runtime trace was collected here. The report must be reproduced across start, stream, stop, crash cleanup, and process-type paths before closure.
- Evidence rule: historical handoff claims and user reports are recorded as context, not as passing test evidence. Only exact reproducible command output or a reviewed runtime trace may move the affected task to Done.

## 2026-07-30 Agent Verification Reports

- AI-entry agent report: TypeScript passed; 4 changed files and 32 focused tests passed. Scope covers the retained AI workflow-creation entry integration. This is focused evidence only; it does not establish browser or full-suite success.
- Git-baseline agent report: the backup regression when Git baseline/change tracking is disabled was fixed; `109/109` focused tests passed and TypeScript passed. This is agent-reported focused evidence; independent runtime confirmation and ACP lifecycle coverage remain open.
- Status consequence: Task 11 moves to **In Review**; Task 8 moves to **In Review**; Task 10 remains **In Progress** because the configured full suites have not been rerun and recorded.
- ACP follow-up: a later handoff reports ACPX lifecycle cleanup, queue stop, FIFO, and backend cleanup logging fixes with focused `76/76` passing. A real cross-process matrix for Codex, Claude, OpenCode, and other `acpx` process types remains open.

## 2026-07-30 Coordinator Full-Suite Failure Triage

- Command: `npm test -- --reporter=json --outputFile=target/npm-test-results.json`.
- Result: **16 failed assertions across 10 test files**. This is the current coordinator run; it supersedes the earlier unverified count of 19 failures for this triage record. The command exited with code 1.
- Lightweight API cluster (1 assertion): `tests/api-workspace-routes.test.ts` / `workspace tree loads nested directories only when requested as a subtree` failed because the returned `src` node contains an additional field compared with the test contract. This is assigned to the lightweight workspace-tree/API repair cluster.
- Mock/provider cluster (11 assertions): `tests/api-agents-runtime-registry.test.ts` returned HTTP 500 instead of 200; `tests/api-chat-route.test.ts` had two failures because the `@/lib/core/app-paths` mock lacks `getWorkspaceRunsDir`; `tests/components/AgentEditModal.test.tsx` lacked `ComboboxPortalProvider` in the combobox mock; `tests/components/ModelDiagnosticsWorkbench.test.tsx` had six failures because no `QueryClientProvider` was installed; and `tests/plugins/agora-chat-panel.test.tsx` failed for the same missing QueryClient provider. These are test mock/provider or route-import compatibility regressions, not accepted as product failures until isolated.
- Environment cluster (4 assertions): `tests/run-state-persistence.test.ts` failed with Windows `EBUSY` while unlinking `chat-sessions.sqlite`; `tests/wechat-official-service.test.ts` and `tests/wechat-session-notifier.test.ts` failed with Windows `EPERM` while removing temporary directories; `tests/components/WorkspaceDirectoryPicker.test.tsx` failed with `document is not defined` because the default run did not use jsdom. These require test isolation/configuration or environment-specific cleanup before being counted as implementation failures.
- Status: Task 10 remains **In Progress**. This historical triage's lightweight API, mock/provider, Windows environment, and ModelDiagnostics clusters have subsequent focused repair evidence; the `NewConfigModal` AI-entry copy assertion remains. No source or tasklist file was changed during the test run itself; this entry is the subsequent documentation synchronization.
- Next steps: fix the `NewConfigModal` copy assertion, append the final AI-entry agent report, then rerun `npm test`, `npm run test:components`, and `npm run test:e2e` with exact output recorded. Keep Task 8 and Task 11 in review until the remaining AI-entry browser/session and full-suite evidence is green.

## 2026-07-30 Workbench Runtime Follow-Up

- The Workbench dynamic-import/browser failure is no longer an open gap. The exact evidence is recorded in the 11:29:43 entry above and covers focused test, Vite build, TypeScript, clean server `5187`, and browser import.
- Task 7 is therefore aligned to `Done` in the coordinator README. Task 8 remains `In Review` while its independent static/evidence review and the retained AI-entry flow are unfinished.
## 2026-07-30 14:46:45 Task 13 Runtime Defect Registration

- Scope: coordinator-only tasklist synchronization after user reproduction. No source implementation or verification command is claimed in this entry.
- Reproduced behavior to correct: a genuine agent step failure was followed by downstream state progression; an active run opened through `history=1` did not refresh state graph, overview, or output until the page reloaded; stop progress exposed `跳过 agent 进程清理（未能解析出待停止 run 的 ACP 会话，避免按目录误伤其他 run）`, which also shows the cleanup path had insufficient ACPX attribution and did not stop the agent.
- Delegation: Task 13A owns `stop/route.ts` and `process-manager.ts` with direct tests; Task 13B owns state-machine failure gates and transition tests; Task 13C owns Workbench live history sync/progress rendering. The scopes are disjoint and started concurrently.
- Cross-platform review: Task 13D was added after the user flagged potential Linux failure. It traces the complete `runId -> runtime session -> ACP record -> pid -> descendant` eligibility chain without editing code; its findings gate 13A review.
- Status: `0% / In Progress`. The earlier full-suite result is retained as historical pre-change evidence and cannot close Task 13 or the reopened Task 10 gate.
## 2026-07-30 15:02:50 Task 13C Workbench Review

- Child-agent scope: `WorkbenchClient.tsx` and `tests/workbench-history-live-sync.test.ts` only.
- Reviewed implementation: an explicitly addressed history run enables compact status querying, scoped status polling, scoped status SSE, and event-sequence reconciliation; the global event stream remains disabled for that history view so it cannot switch the page to a different run.
- Reviewed UI boundary: stop progress maps backend data to a fixed set of user-facing phases and drops detail strings and unrecognized ACP/session diagnostic steps.
- Agent-reported focused verification: `4/4` Vitest cases passed and lint had no errors. TypeScript was not accepted as a Task 13C result because concurrent Task 13B changes were still type-incomplete.
- Status consequence: Task 13 moves from `0%` to `25%`. This is focused evidence only; Task 13A, 13B, 13D, and the reopened full gate remain pending.
## 2026-07-30 15:07:01 Task 13D Cross-Platform Stop Audit Review

- Scope: read-only source and existing-test audit of the run-scoped ACPX stop chain on Linux and Windows; no files or processes were changed by the reviewer.
- Finding: Linux has a platform process-table/signal path, but no-op remains possible whenever `runId -> runtime session -> ACP record -> live PID/start identity -> tree` fails. Windows has the same attribution requirements even after a platform process-table implementation.
- Required correction: use already captured exact run scope after manager-stop timeout/failure; include ACPX one-shot `record.name`; do not reject a proven record ID/PID/start-time match merely because it is marked closed, reparented, its CWD differs, or its mtime is old. Keep broad workspace or machine sweeps prohibited.
- Follow-up risk: explicit child PID ownership (or a platform process-group primitive) is needed for detached descendants; parent/child run coverage and `queryAgent` run propagation require direct regression evidence.
- Status consequence: Task 13 moves from `25%` to `35%`; Task 13A and 13B remain active.
## 2026-07-30 15:12:49 Task 13B Failure-Gate Review

- Child-agent scope: state-machine manager, direct force-transition/resume routes, and direct regression tests.
- Reviewed behavior: a true step exception marks a failed checkpoint and prevents `evaluateTransitions`; resume retains the failed-step retry point; force transition/jump is rejected from manager and route paths while `failedSteps` remains nonempty; circuit breaking requires an explicit route matching the current verdict and preserves its `from` state.
- Attribution repair: supervisor/agent queries now pass the active run ID through runtime and process registration.
- Child-agent verification: `npx vitest run tests/state-machine-workflow-manager.test.ts tests/api-workflow-recovery-routes.test.ts` reported `120/120` passing; `npx tsc --noEmit` passed.
- Open handoff: stopping a parent run still needs proof that every active non-detached child run is added to the same exact cleanup scope. Task 13A owns this with the cross-platform process cleanup work.
- Status consequence: Task 13 moves from `35%` to `60%`.
## 2026-07-30 15:24:02 Task 13A Coordinator Review Correction

- Reviewed initial handoff: run-scoped record/PID cleanup, Windows process enumeration, backend-only diagnostics, manager-stop failure continuation, and recursive child scope are present with agent-reported `44` focused passes and TypeScript success.
- Finding: `loadSweepState` was introduced as a safe recursive state-read boundary but recursive discovery still called `loadRunState` directly. A read failure for one child could abort cleanup already captured for the parent.
- Finding: adding child IDs to ACPX cleanup scope alone does not guarantee an active child manager or persisted child state becomes stopped; that would leave UI/history and in-memory runtime inconsistent after parent stop.
- Action: returned the two corrections to the responsible stop-cleanup child agent. Task 13 remains `60%`; the initial handoff is not accepted as final stop-cleanup evidence.
## 2026-07-30 15:32:34 Task 13A Stop-Cleanup Acceptance Review

- Reviewed scope: run-scoped ACPX cleanup, Windows process-table support, backend-only diagnostics, manager-stop failure continuation, and parent/child run coordination.
- Exact ownership rule: a target record must match the captured run scope and live PID/start-time identity. Once that is proven, closed-state, CWD, ancestry, and age metadata do not suppress cleanup. Broad workspace/machine sweeps remain prohibited.
- Child coordination: safe read failures exclude only the unreadable child; exact active non-detached descendants are best-effort manager-stopped and persisted as `stopped`, while detached/missing/conflicting records remain untouched.
- Child-agent verification: `npx vitest run tests/process-manager.test.ts tests/api-workflow-stop-route.test.ts` reported `46` passing; `npx tsc --noEmit` passed; targeted `git diff --check` passed (CRLF warnings only).
- Status consequence: Task 13 moves from `60%` to `80% / In Review`. Independent combined verification and the reopened full gate remain required; real Linux process-tree execution is still environment-specific verification.
## 2026-07-30 15:41:06 Task 13E Independent Verification And Rejection

- Combined command: `npx vitest run tests/workbench-history-live-sync.test.ts tests/state-machine-workflow-manager.test.ts tests/api-workflow-recovery-routes.test.ts tests/process-manager.test.ts tests/api-workflow-stop-route.test.ts` exited `0` with `5 files / 168 passed / 0 failed` in `5.95s`.
- TypeScript: `npx tsc --noEmit` exited `0`.
- Diagnostic scan: all raw ACP-skip phrase matches were test fixtures/assertions; no match remained in `src/client` or the workflow stop route.
- Blocking review finding: `rerun-from-step` has no unresolved-`failedSteps` gate and `WorkflowManager.rerunFromStep` starts the requested historical state before the later transition guard. This violates the failed-checkpoint recovery lock.
- Status consequence: Task 13 moves from `80%` to `75% / In Progress`; the combined passing test result is retained as pre-13F evidence, not final acceptance. Real Linux process-tree execution remains an environment-specific verification gap.

## 2026-08-01 Task 23 Tool-Group Stability Review

- Scope: `RuntimeToolEventList` group-collapse timing only.
- Reviewed behavior: when a streaming tool group temporarily has no running calls, it holds open for a resettable 400 ms stability window. A subsequent running call clears that timer; ending the stream still closes the group immediately.
- Verification: `npx vitest run tests/components/RuntimeToolEventList.test.tsx` reported `5 passed`.
- Status consequence: Task 23 is accepted at `100%`. No broad suite was run for this isolated UI interaction repair.

## 2026-08-01 Task 18 Workbench Action Review

- Scope: Dashboard Shell name-edit action and ordinary successful-start navigation in `WorkbenchClient.tsx`.
- Reviewed behavior: active dashboard headers receive the inline workflow-name input as a leading action; blur/Enter copy the name into the current edit draft and use the established design save path. A returned ordinary run ID is immediately selected, switched into the runs/overview surface, placed into the URL, and retained until history returns its row.
- Verification: `git diff --check` passed. Browser verification is deliberately pending user manual confirmation; no broad test suite was run.
- Status consequence: Task 18 is `90% / In Review` rather than Done.

## 2026-08-01 Task 19 Lightweight Authoring Review

- Scope: lightweight branches in `NewConfigModal`, `LightweightWorkflowDesignPanel`, and config creation route.
- Reviewed behavior: no optional step-Skills UI remains; the tasklist skill is fixed internally; generated lightweight configs strip supervisor and transition-cap fields after schema normalization. Direct non-AI creation uses a ref-based same-tick re-entry guard and visible create-in-progress state.
- Verification: static search and `git diff --check` passed. Browser confirmation remains pending by request; no broad suite was run.
- Status consequence: Task 19 is `90% / In Review`.

## 2026-08-01 Task 21 Runtime Tasklist Path Audit (Historical, Superseded)

- Scope: read-only trace of lightweight configuration, start/resume metadata, document-root resolution, and Agent instruction paths.
- Historical finding at the pre-implementation snapshot: the design still derived and resolved `docs/tasklists/<config>` under the configured project workspace. `getWorkspaceRunsDir()` supplied the canonical runtime parent but had no shared per-run helper.
- Required target: `<ACE runtime>/runs/<runId>/tasklist`, with persisted runtime metadata and resume/document-root containment checks. Legacy workspace-root metadata must fail closed rather than write to the workspace.
- Status consequence at that snapshot: Task 21 remained pending implementation after Task 22 because the startup and recovery files overlapped. It is superseded by the accepted Task 21 runtime-storage entry above.

## 2026-08-01 Task 24 Lightweight Design Integration Review

- Scope: lightweight design panel props, its state-machine design container call, and focused component tests.
- Reviewed behavior: no stale `availableSkills` prop remains, the panel has no arbitrary-prop escape hatch, and state/task edits force exactly the internal `aceharness-tasklist` Skill.
- Verification: `npx vitest run tests/components/LightweightWorkflowDesignPanel.test.tsx` reported `1 file / 3 tests passed`.
- Status consequence: Task 24 is accepted at `100%`.

## 2026-08-01 Task 35 ACPX Opaque Subagent Regression Registration

- User live reproduction remains open: provider-private ACPX `spawnAgent` and `wait` cards render as `other` in both terminal and running states, and the lightweight overview reports no child-Agent activity.
- Read-only source trace: runtime projection already maps canonical `spawnAgent`/`wait` names to `subagent-dispatch`/`subagent-wait`; the existing ACPX persisted ToolUse enrichment only starts from `source.toolCallId` and copies a narrow subset of fields. That is insufficient for opaque event-ID variants and lifecycle continuity.
- Delegation: one bounded child agent owns shared ACPX adapter normalization and focused adapter/task-board regression coverage. The coordinator owns tasklist status and acceptance review.
- Acceptance boundary: no Codex-only UI fallback, no fabricated Agent cards, and no status change until real persisted ToolUse metadata reaches both live labels and task-board evidence.
