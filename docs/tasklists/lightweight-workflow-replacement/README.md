# Lightweight Workflow Replacement Task List

Updated: 2026-08-01 18:34:00 +08:00

This document set is based on the approved lightweight-workflow replacement design discussion, the `feature/lightweight-workflow-replacement` worktree at `96e9ef6`, current source and test inspection, and task handoffs through 2026-07-30. It is the coordinator-owned implementation plan, acceptance checklist, and status board for removing the legacy fixed-flow creation implementation while adding tasklist-driven lightweight workflows. The user-facing AI workflow-creation entry is retained as an independent planning flow and can produce either a lightweight workflow or a state-machine workflow.

## Entrypoints

- [Design locks](00-design-locks.md)
- [Dependency and execution plan](implementation-order.md)
- [Current verification gaps](verification-gaps.md)
- [Recent verification](verification-log.md)
- [Out of scope](out-of-scope.md)

## UI Scope Lock

- The mode-selection UI keeps `轻量工作流`, `状态机模式`, and `AI 引导创建` as three independent choices.
- `AI 引导创建` remains a planning flow: structured AI results select `lightweight` or `state-machine`, then the confirmed draft is validated and created. The persisted workflow contract remains `lightweight | state-machine`; `ai-guided` is a UI entry, not a persisted workflow mode.
- The current lightweight workflow remains tasklist-driven: dynamic task decomposition, scheduling, and acceptance; state-machine capabilities remain represented by the lightweight runtime contract rather than by restoring the old mode selector.

## Execution Ownership

- Coordinator (root agent): schedule, delegate, review, update this README's percentages, and report final results.
- Child agents: implement only their assigned scopes and return changed artifacts, verification evidence, blockers, and newly discovered dependencies.

## Task Documents

- [Task 1: Core contract and state-machine-only runtime](01-core-contract-and-runtime.md)
- [Task 2: Remove legacy command and creation plugins](02-remove-legacy-command-and-plugins.md)
- [Task 3: Rename and lock tasklist skills](03-rename-and-lock-tasklist-skills.md)
- [Task 4: Document roots and output display](04-document-roots-and-output-display.md)
- [Task 5: Lightweight creation and design UI](05-lightweight-creation-and-design-ui.md)
- [Task 6: Runtime session and Agora backend removal](06-runtime-session-and-agora-backend.md)
- [Task 7: Workbench runtime integration](07-workbench-runtime-integration.md)
- [Task 8: Static audit and documentation sync](08-static-audit-and-doc-sync.md)
- [Task 9: Subworkflow result propagation regression](09-subworkflow-result-propagation-regression.md)
- [Task 10: Full test-suite gate](10-full-test-suite-gate.md)
- [Task 11: Retain AI-guided workflow creation](11-ai-guided-workflow-creation-retention.md)
- Task 12: 新增设置与 CLI 环境变量问题（状态跟踪见下方）
- [Task 13: Workflow failure gating, live history sync, and stop cleanup](13-workflow-failure-gating-live-history-sync-and-stop-cleanup.md)
- [Task 14: ACPX tool-result recovery and live-output regression](14-acpx-tool-result-recovery-and-live-output.md)
- [Task 15: Homepage invalid-model send failure visibility](15-homepage-invalid-model-send-failure-visibility.md)
- [Task 16: AI-guided recovery and phase-mode removal](16-ai-guided-workflow-recovery-and-phase-removal.md)
- [Task 17: Default tasklist location and viewer](17-default-tasklist-location-and-viewer.md)
- [Task 18: Workbench header actions and new-run navigation](18-workbench-header-actions-and-new-run-navigation.md)
- [Task 19: Lightweight authoring contract simplification](19-lightweight-authoring-contract-simplification.md)
- [Task 20: Lightweight runtime navigation simplification](20-lightweight-runtime-navigation-simplification.md)
- [Task 21: Runtime tasklist storage relocation](21-runtime-tasklist-storage-relocation.md)
- [Task 22: Lightweight supervisor-free runtime](22-lightweight-supervisor-free-runtime.md)
- [Task 23: Stable trailing tool-call groups](23-stable-trailing-tool-call-groups.md)
- [Task 24: Lightweight design integration cleanup](24-lightweight-design-integration-cleanup.md)
- [Task 25: Workbench tool-group identity stability](25-workbench-tool-group-identity-stability.md)
- [Task 26: Trailing tool-group three-second hold](26-trailing-tool-group-three-second-hold.md)
- [Task 27: Lightweight runtime task board and agent view](27-lightweight-runtime-task-board-and-agent-view.md)
- [Task 28: Lightweight overview observability](28-lightweight-overview-observability.md)
- [Task 29: Current TypeScript gate repair](29-current-typescript-gate-repair.md)
- [Task 30: Lightweight preparation status alignment](30-lightweight-preparation-status-alignment.md)
- [Task 31: Full gate regression repair](31-full-gate-regression-repair.md)
- [Task 32: ACPX terminal token usage and retained live output](32-acpx-terminal-token-usage-and-retained-live-output.md)
- [Task 33: Lightweight task execution graph](33-lightweight-task-execution-graph.md)
- [Task 34: Lightweight supervisor design migration](34-lightweight-supervisor-design-migration.md)
- [Task 35: ACPX opaque subagent tool classification](35-acpx-opaque-subagent-tool-classification.md)

## Current Judgment

- Tasks 1, 2, 3, 4, 6, and 9 are done. Their implementation and verification evidence is archived in the corresponding task records and shared verification log.
- Task 5 is **Done** at 100%. The current lightweight creation/design contract and retained AI planning handoff passed `9 files / 63 tests`; lightweight tasklists remain run-owned and AI confirmation may choose lightweight or state-machine.
- Task 7 is **Done**. The user confirmed the SSR startup/module-loading issue is resolved; its existing Workbench integration evidence remains recorded in the task document.
- Task 25 is **Done**. The Workbench virtual-list identity now remains stable as a contiguous tool group completes or grows, so the trailing debounce is preserved instead of being reset by a remount. Focused verification passed `7 tests`.
- Task 26 is **Done**. The terminal tool-group hold is 3 seconds while streaming; the next tool resets it and stream end still closes immediately. Focused verification passed `7 tests`.
- Task 22 is **Done**. Lightweight validation, formal/rehearsal startup, agent prewarm, persistence, and resume exclude `default-supervisor`; ordinary state-machine coverage retains its default-supervisor behavior. Focused verification passed `3 files / 168 tests`.
- Task 21 is **Done**. Start, rehearsal, manager resume, document roots, creation metadata, and AI assembly now use `<ACE runtime>/runs/<runId>/tasklist`; legacy workspace-root metadata fails closed. Focused verification passed `7 files / 208 tests`.
- Task 8 is **Done** at 100%. Current static reconciliation corrected stale AI/tasklist wording, found no active phase-mode or workspace tasklist-directory regression, and passed focused document/Workbench and AI creation evidence. Task 10 owns the release gate.
- Task 10 is **In Progress for a fresh rerun**. The pre-Task-28 TypeScript errors are repaired; focused verification and `npx tsc --noEmit` now pass. The prior component/E2E pass and Vitest timeout are historical only, and all configured gates are being rerun against the repaired worktree.
- Task 11 is **Done** at 100%. The retained AI planning entry is covered by `9 files / 63 tests`: selecting the UI entry does not create an empty session, planning starts on submission, and confirmed output can create lightweight or state-machine without persisting `ai-guided`.
- Task 12 is done at 100%. System settings no longer expose the Memory V2 frontend tab/UI. System CLI environment variables are embedded directly in the `SystemSettingsContent` `environment` section through the shared `EnvVarsEditor` inline; there is no system dialog, edit button, or `systemEnvDialogOpen` state. Personal CLI environment variables still use the global `EnvVarsDialog` with Claude, Codex, OpenCode, and other CLI tabs; the password `ObjectEditDrawer` remains. ACPX resolves `personal > system > host`: an unset personal value uses the system value, and when both configured layers are unset, acpx inherits the host value. Empty, null, undefined, or disabled entries cannot replace a valid lower-layer value. Startup and reconnect both read the latest configuration. The final focused rerun is `2 files / 36 passed`; the separate agent-reported complete coverage is `3 files / 45 passed`, including provider coverage and trace redaction. The two unreferenced frontend Memory V2 UI files and the AccountPage avatar explanation were removed; backend `memory-v2` remains available.
- The Windows test-environment cleanup repair is recorded as passing across 3 files and 34 tests. This closes the reported SQLite/temp-directory cleanup cluster only; it does not close the full-suite gate.
- The Git-baseline-disabled application path is accepted. This does not establish that ACPX itself performs no `.git` file access; that process-level behavior remains a separately tracked runtime-tracing follow-up.
- Frontend memory-handoff and Werewolf UI surfaces are removed; necessary detailed logs remain backend-visible, while the frontend should show only the required summary.
- Task 13 is **In Review** at 99%. Current focused suites passed `6 files / 192 tests`; WSL2 Linux integration also proved production process-manager selects and kills only the target record's real parent/child tree. A live ACPX agent session was unavailable in WSL, so that provider-specific proof and the shared final gate remain open.
- Task 14 is **In Review** at 95%. Its terminal output/error preservation remains covered, but the user has reproduced an uncovered ACPX private-tool regression: `spawnAgent` and `wait` still arrive as `other`. Task 35 owns the shared event-classification and task-board evidence repair; Task 14 cannot be accepted as complete until that handoff is reviewed.
- Task 15 is **In Review** at 99%. Both ordinary and streaming chat routes reject a selected model with no active compatible runtime route before context/session/stream registration, while the client keeps the failure visible. Focused verification passed `4 files / 33 tests`. The shared TypeScript and full-suite gate remains pending.
- Task 17 is **Done** at 100%. The tasklist directory is kept as a system-derived runtime detail; creation, design, and lightweight run overview surfaces no longer display its path. Run documents support source filtering, and the Workbench exposes `步骤文档` and `任务清单` entries with direct tasklist preview. Focused verification passed `3 files / 12 tests`; the active Vite Workbench module returned HTTP 200.
- Task 18 is **In Review** at 95%. The Dashboard Shell name action saves the current immutable design draft exactly once; successful ordinary starts immediately select and route to the returned run, and stale history responses preserve that local selection. Focused verification passed `9/9`; browser confirmation remains pending.
- Task 19 is **In Review** at 95%. Lightweight creation/design no longer expose step-level Skills, tasklist paths, transition limits, or supervisors; direct creation now has an actual loading lock across its Agent/target/button controls. Focused verification passed `11/11`; browser confirmation remains pending.
- Task 20 is **Done**. Lightweight runs expose `任务清单` instead of a state graph or generic step documents; the tasklist view hides source-switching tabs while state-machine navigation remains unchanged. Focused verification passed `1/1`.
- Task 23 is **Done** at 100%. The reusable runtime tool group now holds a streaming terminal tail open for a resettable 3 s stability window; a next tool cancels the pending collapse, while a finished stream still closes normally. Task 25 confirms Workbench preserves that group identity. Focused component verification passed `7 tests`.
- Task 24 is **Done** at 100%. The stale design-container prop is removed, the lightweight panel has a strict prop contract, and focused tests verify no step-Skills control plus only the internal tasklist Skill after edits.
- Task 27 is **Done** at 100%. Lightweight runs use a dedicated task board rather than the ordinary Agent formation: it shows the primary Agent, actual child-Agent activity, task owner/current work, dependencies, serial/parallel grouping, and real completion evidence. Lightweight tasklist documents use two columns; state-machine presentation remains unchanged. Coordinator verification passed `6 files / 15 tests`.
- Task 28 is **Done** at 100% as the Token observability slice. Its original persistent preparation-card presentation is superseded by Task 30; the runtime status/location remains the source of truth for preparation display.
- Task 29 is **Done** at 100%. The TypeScript gate's catalog/document/API residuals are repaired without widening domain contracts; coordinator verification passed `2 files / 5 tests` and TypeScript.
- Task 30 is **Done** at 100%. Lightweight preparation now follows the state-machine presentation: the shared location shows the live phase and step together, such as `准备阶段 / 同步 Skills`, and reused execution surfaces label the status `准备中`; no persistent Skills/Git preparation cards are rendered, and Token consumption remains available. Focused verification passed `1 file / 2 tests` and TypeScript.
- Task 31 is **In Review** at 95%. The recommendation policy and model-selector loading regressions were repaired by the child agent; focused regressions and TypeScript passed. The complete Task 10 gate remains required.
- Task 32 is **Done** at 100%. Completed, failed, and sole lightweight execution steps retain their persisted live-output sources. ACPX terminal failures and cancellations now retain reported token usage and cost through runtime projection, failed step logs, Agent totals, and run state; focused verification passed `3 files / 182 tests`.
- Task 33 is **Done** at 100%. Lightweight runs now have a standalone `状态图` navigation entry using the established graph UI for task dependencies, serial/parallel grouping, runtime status, owners, and progress. The overview retains its primary/child Agent and tasklist panel, while the separate lightweight `Agents` navigation item is removed. Focused verification passed `1 file / 9 tests`.
- Task 34 is **Done** at 100%. The reported historical lightweight config was directly migrated; read/save/validate boundaries remove obsolete supervisor data and per-Agent overrides; the lightweight design engine-policy roster no longer shows `default-supervisor`, while state-machine supervisor behavior is unchanged. Focused verification passed `3 files / 19 tests` and TypeScript.
- Task 35 is **In Progress** at 10%. It is a live user-reproduced ACPX regression: opaque provider-private `spawnAgent`/`wait` calls still display as `other` and leave the lightweight child-Agent panel without evidence. A child agent owns shared adapter normalization and focused regression coverage; coordinator acceptance must confirm both live labels and task-board evidence.

The board does not currently represent a releasable completed state. The last coordinator gate (`7 files / 81 tests`, TypeScript, full Vitest `163 files / 1077 passed / 6 skipped`, components `30 files / 137 tests`, and Playwright `5/5`) is retained as historical evidence only. Current acceptance is blocked by the unverified AI-creation recovery and remaining implementation/review work.

## Current Coordinator Blockers

- **AI-guided recovery and phase-mode removal (Task 16): In Review.** The residual linear labels and `phase-based` documentation are removed; focused selector/modal/page/create coverage passed `4 files / 28 tests`. Browser confirmation of the retained multi-step AI journey and the shared final gate remain.
- **SSR startup and module loading: Resolved.** The user confirmed this blocker is complete on 2026-08-01. It is no longer a dependency for browser verification or the final gate.
- **Current worktree gate: Not accepted.** Existing passing commands below and in `verification-log.md` describe earlier snapshots. No current full-suite or browser acceptance is claimed after the latest creation/runtime changes.
- **ACPX opaque subagent calls (Task 35): In Progress.** The current UI evidence is not accepted: `other` is still rendered for provider-private `spawnAgent`/`wait`, and child-Agent activity remains empty. The repair must happen before shared runtime projection, then prove the task board consumes the recovered metadata.

Latest AI creation recovery slice (2026-07-31 15:32): `tests/workflow-creation-items.test.ts` and `tests/api-configs-create.test.ts` passed `2 files / 11 tests`. Structured AI workflow selection now records `lightweight | state-machine`; lightweight assembly emits one final execution state with the tasklist skill and filename-derived tasklist directory; the create route accepts a lightweight `configDraft` without `body.lightweight` and derives session metadata from its step. The focused TypeScript output contains no errors from these changed files. The repository-wide TypeScript gate remains blocked by pre-existing errors in unrelated dirty files and is not counted as this slice's result.

Latest Task 14/15 revalidation slice (2026-07-31): `npx vitest run tests/runtime-adapters.test.ts tests/workflow-runtime-model-route.test.ts tests/components/RuntimeToolEventList.test.tsx` passed `3 files / 59 tests`; `npx vitest run tests/chat-context.test.tsx tests/api-chat-runtime-model-route.test.ts tests/api-chat-route.test.ts tests/api-chat-stream-flow.test.ts` passed `4 files / 32 tests`. These are current focused results, not a substitute for the pending shared TypeScript/browser/full-suite gate.

## 新增设置与 CLI 环境变量问题

Status: **Done** (`100%`)

- 已删除系统设置中的 Memory V2 前端 tab/UI，并加入系统级 CLI 环境变量设置。
- 系统 CLI 环境变量直接内嵌在 `SystemSettingsContent` 的 `environment` section，使用共享 `EnvVarsEditor` inline；不再有 system dialog、编辑按钮或 `systemEnvDialogOpen`。个人 CLI 环境变量仍使用全局 `EnvVarsDialog` modal，提供 Claude、Codex、OpenCode 和其他 CLI tabs；密码修改继续使用现有 `ObjectEditDrawer`。
- ACPX 在启动和重连时注入合并后的环境变量，优先级为 `个人 > 系统 > 宿主`；空值、未定义值和停用项不会覆盖下层有效值。
- 用户界面采用友好的正面功能介绍，内部过程信息保留在后台日志与诊断范围内，不展示在设置页面。
- 本轮最终 focused 复跑为 `2 files / 36 passed`；并行 agent 的完整 focused coverage 为 `3 files / 45 passed`，两组数字分别记录，不合并为单一结果。`npx tsc --noEmit` 通过。本轮最终本地全量 `npm test` 为 `158 文件 / 1005 passed / 6 skipped / 0 failed`；组件 `29 文件 / 131 passed / 0 failed / 0 skipped`、E2E `5/5` 也通过。
- 最新 UI 回归验证：`npx vitest run tests/components/EnvVarsDialog.test.tsx --environment jsdom` 为 `1 file / 3 passed`；`npm run test:components` 为 `29 files / 131 passed`；`npx tsc --noEmit` 通过。
- 历史证据保留：此前的 focused `37/37`、全量 `999 passed`、新增测试断言前的 `1003 passed`，以及上一轮最终 `158 files / 1004 passed / 6 skipped / 0 failed` 均见 `verification-log.md`，并明确标注为 historical，不作为当前结果。
- 清理边界已完成：删除未被引用的前端 `MemoryV2DiagnosticsPanel.tsx`、`MemoryV2GovernancePanel.tsx` 两个 UI 文件，移除 `AccountPage.tsx` 的头像内部说明；后端 `memory-v2` 实现、数据与运行时能力保留，未做后端删除。
- 静态复核未再发现上述两个 UI 文件或两条指定内部文案；系统设置与个人设置的既有功能保持可用。
- 兼容说明：现有 `/api/env` 用户/系统 scope 与权限契约保持不变；未设置个人值时使用系统值，系统也未设置时由 acpx 继承宿主环境；ACPX 在启动和重连时读取最新合并环境，`process-manager.ts` 没有额外的 ACPX 注入点；trace 仅保留脱敏后的后台诊断信息。
- 真实运行探针：Claude 和 OpenCode 已完成真实 ACPX spawn、ACP 初始化与 turn 链路；Claude 因 CLI 未认证返回认证错误，OpenCode 完成 turn。Codex 受宿主 `~/.codex/config.toml` 中不兼容的 `reasoning_effort=max` 阻塞，未将该宿主配置问题归因于 ACPX 环境注入。

## Historical Coordinator Snapshot

As of `2026-07-30 17:13:10 +08:00` (archived evidence; superseded by the current status above):

- AI-entry implementation is now reported complete at the focused level: `WorkflowModeSelector` exposes the third `AI 引导创建` card; clicking it opens the planning flow and creates/reuses a session only after the user starts planning; structured results can converge on lightweight or state-machine creation. `WorkflowsPage` and `ChatPageContent` are connected. The AI-entry focused set is `15/15` passing.
- Latest Task 12 focused evidence: the final rerun passed `2 files / 36 passed`; the separate agent report passed `3 files / 45 passed` with provider coverage and trace-redaction assertions; `npx tsc --noEmit` passed.
- Latest Task 12 UI evidence: `SystemSettingsContent` renders system CLI environment variables inline in its `environment` section through shared `EnvVarsEditor`; the system dialog, edit button, and `systemEnvDialogOpen` state are absent. Personal CLI environment variables still use the global `EnvVarsDialog`. `npx vitest run tests/components/EnvVarsDialog.test.tsx --environment jsdom` passed `1 file / 3 passed`.
- Latest local real gate after the inline UI change: `npm run test:components` passed with `29 files / 131 passed / 0 failed / 0 skipped`; `npm test` passed with `158 files / 1005 passed / 0 failed / 6 skipped`; `npm run test:e2e` passed with `5 passed / 0 failed / 0 skipped`; `npx tsc --noEmit` exited with code 0.
- Cleanup boundary verified: `MemoryV2DiagnosticsPanel.tsx` and `MemoryV2GovernancePanel.tsx` are deleted, `AccountPage.tsx` no longer contains the avatar internal explanation, and backend `memory-v2` remains retained. No residual match was found for the deleted UI names or specified copy.
- Additional recorded focused evidence: ModelDiagnostics `16/16`; API/mock repair cluster `3/3`; `api-workspace-routes.test.ts` `6 passed / 4 skipped`; Agora `18/18`; `WorkspaceDirectoryPicker` `1/1`; `AgentEditModal` `1/1`; Windows cleanup `3 files / 34 tests`. Task 8 independently accepted the Git-baseline-disabled repair with `2 files / 131 passed`, TypeScript, and a real temporary-directory probe covering disabled directory/worktree `.git` exclusion and enabled compatibility.
- Workbench dynamic-import verification is now complete: focused test `2/2`; `npx vite build -c vite.start.config.mts` succeeded (client 8005 modules, SSR 970 modules); `npx tsc --noEmit` passed; clean dev server `http://127.0.0.1:5187` returned `200` for `/login`, the Workbench route, and the exact module URL; browser `import('/src/client/pages/workbench/WorkbenchClient.tsx')` resolved to a function with no `5xx/503`.
- Task 13 is accepted at `100%`: final independent verification passed `11 files / 225 tests` and TypeScript. `rerun from step` is a visible explicit action, force recovery is preserved without weakening ordinary failure gating, historical rerun attempts remain backend-readable as `superseded`, history links stay live, and cleanup diagnostics remain backend-only. Real Linux process-tree execution remains an environment-specific integration test gap.
- Task 10 was accepted at `100%` in that archived snapshot: `npm test` passed `160 files / 1047 passed / 6 skipped`; component-jsdom passed `29 files / 132 passed`; Playwright passed `5`; and TypeScript passed. This does not certify the current dirty worktree. Task 12 remains `Done` at `100%` within its settings boundary.

## Overview

| Progress | Task | Status | Depends On | Execution | Notes |
|----------|------|--------|------------|-----------|-------|
| 100% | Task 1: Core contract and state-machine-only runtime | Done | None | Parallel wave 1 | Core contract and runtime handoff is marked done; final workstream verification remains separate. |
| 100% | Task 2: Remove legacy command and creation plugins | Done | None | Parallel wave 1 | Legacy `/workflow` and dedicated creation-plugin paths are reported removed; generic chat and runtime APIs remain in scope. |
| 100% | Task 3: Rename and lock tasklist skills | Done | None | Parallel wave 1 | Canonical `aceharness-tasklist` identity and caller-owned tasklist directory contract are documented. |
| 100% | Task 4: Document roots and output display | Done | Tasks 1, 3 | Parallel wave 2 | Source-aware task documents and persisted runtime outputs are reported integrated; final audit remains open. |
| 100% | Task 5: Lightweight creation and design UI | Done | Tasks 1, 2, 3 | Revalidated | Current lightweight design and retained AI planning handoff passed `9 files / 63 tests`. |
| 100% | Task 6: Runtime session and Agora backend removal | Done | Tasks 1, 2, 3 | Parallel wave 2 | Ordinary conversation binding, workflow event persistence, and workflow-room removal are reported complete. |
| 100% | Task 7: Workbench runtime integration | Done | Tasks 4, 5, 6 | Parallel wave 3 | Existing focused integration evidence is retained; user-confirmed SSR/module loading recovery closes the current blocker. |
| 100% | Task 8: Static audit and documentation sync | Done | Tasks 7, 9, 11, 13, 16, 27 | Revalidated | Current static reconciliation and focused Workbench/document plus AI creation evidence are accepted; Task 10 owns the release gate. |
| 100% | Task 9: Subworkflow result propagation regression | Done | None | Parallel wave 3 with Task 7 | The task document reports the focused manager suite at 107/107 and preserves the five regression assertions. |
| 90% | Task 10: Full test-suite gate | In Progress | Tasks 8, 28, 29 | Fresh rerun | Task 28/29 focused tests and TypeScript pass; rerun all configured gates against the repaired worktree. |
| 100% | Task 11: Retain AI-guided workflow creation | Done | Tasks 2, 5 | Revalidated | UI-only AI entry, deferred planning session, and lightweight/state-machine assembly passed `9 files / 63 tests`; Task 16 owns the remaining browser smoke. |
| 100% | Task 12: Settings, environment precedence, CLI injection, and positive copy cleanup | Done | Tasks 8, 10 | New follow-up | System CLI variables are inline in `SystemSettingsContent` via shared `EnvVarsEditor`; personal CLI variables remain in the global `EnvVarsDialog` modal. Latest UI focused test `1 file / 3 passed`; component gate `29 files / 131 passed`; `npx tsc --noEmit` passes. Final focused rerun `2 files / 36 passed`; separate agent coverage `3 files / 45 passed`; latest local `npm test` `158 files / 1005 passed / 0 failed / 6 skipped`, E2E `5/5`. Two unreferenced frontend Memory V2 UI files and the AccountPage avatar explanation were removed; backend `memory-v2` was retained. |
| 99% | Task 13: Workflow failure gating, live history sync, and stop cleanup | In Review | None | Current focused revalidation | Current `6 files / 192 tests` plus WSL real process-tree isolation prove core behavior; live ACPX-agent Linux proof and shared gate remain open. |
| 95% | Task 14: ACPX tool-result recovery and live-output regression | In Review | None | Task 35 active | Terminal payload recovery remains covered, but opaque ACPX subagent calls still regress to `other`; Task 35 owns the required shared normalization proof. |
| 99% | Task 15: Homepage invalid-model send failure visibility | In Review | None | Current focused verification passed | Ordinary and streaming routes now fail invalid selected routes visibly before registration; `4 files / 33 tests`; shared gate remains pending. |
| 95% | Task 16: AI-guided recovery and phase-mode removal | In Review | Tasks 5, 7, 11 | Serial recovery with SSR blocker in parallel | AI entry, supported-mode labels, phase removal, and config docs passed `4 files / 28 tests`; browser smoke remains. |
| 100% | Task 17: Default tasklist location and viewer | Done | Tasks 4, 5, 7 | Serial integration | Tasklist placement remains automatically derived and is communicated to the Agent at runtime; Workbench document navigation now separates `步骤文档` and `任务清单`. Focused verification: `3 files / 12 tests`; Vite Workbench module probe: HTTP 200. |
| 95% | Task 18: Workbench header actions and new-run navigation | In Review | None | Wave 11 | Focused history/start and immutable name-draft regression coverage passed `9/9`; browser confirmation remains pending. |
| 95% | Task 19: Lightweight authoring contract simplification | In Review | None | Wave 11 | Focused direct-create loading/re-entry and no-step-Skills coverage passed `11/11`; browser confirmation remains pending. |
| 100% | Task 20: Lightweight runtime navigation simplification | Done | Reviewed Tasks 18, 19 | Serial Workbench slice | Lightweight navigation keeps tasklists and hides state graph, generic step documents, and source tabs; state-machine behavior remains unchanged. |
| 100% | Task 21: Runtime tasklist storage relocation | Done | Tasks 19, 22 | Serial after Task 22 | Canonical run-owned tasklist storage and fail-closed legacy metadata handling passed `7 files / 208 tests`. |
| 100% | Task 22: Lightweight supervisor-free runtime | Done | Task 19 | Wave 11 runtime slice | Lightweight validation, start/rehearsal, prewarm, persistence, and resume exclude `default-supervisor`; state-machine defaults remain covered. Focused tests: `3 files / 168 passed`. |
| 100% | Task 23: Stable trailing tool-call groups | Done | None | Wave 11 UI slice | Streaming terminal groups use a resettable 3 s stability window. Workbench identity integration is accepted by Task 25. |
| 100% | Task 24: Lightweight design integration cleanup | Done | Task 19 | Wave 11 follow-up | Strict panel props and focused no-step-Skills regression test passed (`1 file / 3 tests`). |
| 100% | Task 25: Workbench tool-group identity stability | Done | Task 23 | Serial Workbench owner lane | Stable first-call identity preserves the tail debounce across terminal updates and contiguous appended calls. Coordinated with Task 20 because both touch Workbench. Focused test: `7 passed`. |
| 100% | Task 26: Trailing tool-group three-second hold | Done | Task 23 | Serial UI timing follow-up | Terminal streaming hold is 3 s; reset-on-next-tool and immediate close on stream end are covered by `7` focused tests. |
| 100% | Task 27: Lightweight runtime task board and agent view | Done | Tasks 20, 21 | Two-phase lightweight UI slice | Dedicated primary/child Agent task board and two-column lightweight tasklist documents are accepted; coordinator verification passed `6 files / 15 tests`. |
| 100% | Task 28: Lightweight overview observability | Done | Task 27 | Restored the lightweight overview presentation; a later ACPX terminal-usage persistence regression is tracked separately by Task 32. |
| 100% | Task 29: Current TypeScript gate repair | Done | Task 10 gate report | Repaired concrete compile errors outside Task 28's Workbench lane; coordinator verification passed `2 files / 5 tests` and TypeScript. |
| 100% | Task 30: Lightweight preparation status alignment | Done | Task 28 | Removed persistent preparation cards and aligned the live phase/step location with state-machine runs; Token consumption remains. Focused `1 file / 2 tests`; TypeScript passed. |
| 95% | Task 31: Full gate regression repair | In Review | Task 10 gate report | Child repair passed focused recommendation/model-selection tests and TypeScript; complete Task 10 rerun remains. |
| 100% | Task 32: ACPX terminal token usage and retained live output | Done | Tasks 14, 28 | ACPX now recovers reported terminal usage from status or persisted request/cumulative records, keeps active cancellations open through terminal consumption, and persists failure usage in step logs, Agent totals, and run state. Focused verification: `3 files / 182 tests`. |
| 100% | Task 33: Lightweight task execution graph | Done | Task 27 | Lightweight runs expose a standalone `状态图` backed only by tasklist/runtime evidence; the overview keeps primary/child Agent and tasklist evidence, and the duplicate lightweight `Agents` navigation item is removed. Focused verification: `1 file / 9 tests`. |
| 100% | Task 34: Lightweight supervisor design migration | Done | Tasks 19, 22 | Directly migrated the reported legacy config; lightweight read/save/validate normalization removes supervisor data and overrides, and the design engine-policy roster excludes `default-supervisor`. State-machine supervisor behavior remains unchanged. Focused verification: `3 files / 19 passed`, TypeScript passed. |
| 10% | Task 35: ACPX opaque subagent tool classification | In Progress | Tasks 14, 27 | Delegated shared adapter repair | User still reproduces `other` for opaque `spawnAgent`/`wait`; repair canonical names, ID/input continuity, and child-Agent evidence before focused acceptance. |
