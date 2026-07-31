# Lightweight Workflow Replacement Task List

Updated: 2026-07-30 17:13:10 +08:00

This document set is based on the approved lightweight-workflow replacement design discussion, the `feature/lightweight-workflow-replacement` worktree at `96e9ef6`, current source and test inspection, and task handoffs through 2026-07-30. It is the coordinator-owned implementation plan, acceptance checklist, and status board for removing the legacy phase workflow and `/workflow` creation implementation while adding tasklist-driven lightweight workflows. The user-facing AI workflow-creation entry is retained and must end in the lightweight creation UI/session.

## Entrypoints

- [Design locks](00-design-locks.md)
- [Dependency and execution plan](implementation-order.md)
- [Current verification gaps](verification-gaps.md)
- [Recent verification](verification-log.md)
- [Out of scope](out-of-scope.md)

## UI Scope Lock

- The original mode-selection UI had three choices: `阶段模式` (fixed design -> implementation -> test -> optimization flow), `状态机模式` (problem-driven routing with cross-stage rollback), and `AI 引导创建` (natural-language requirements with AI-selected best practices).
- Current replacement constraint: restore only the `AI 引导创建` entry, and route it into the lightweight creation UI/session. Do not restore the legacy phase-mode UI or a persisted `ai-guided` mode.
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

## Current Judgment

- Tasks 1, 2, 3, 4, 6, and 9 are done. Their implementation and verification evidence is archived in the corresponding task records and shared verification log.
- Task 5 is done at 100%. Independent review found no creation/design acceptance gap; persisted modes remain `lightweight | state-machine`, lightweight topology/tasklist constraints are enforced, AI entry converges into the lightweight creator session, and child selection labels lightweight workflows. Focused evidence: `8 files / 60 passed`.
- Task 7 is done at 100%. Independent review accepted dynamic loading, active-history synchronization, stop-progress filtering, and lightweight/state-machine runtime separation. Focused evidence: `4 files / 19 passed`, Task 13 integration `5 files / 178 passed`, Vite build, and TypeScript.
- Task 8 is done at 100%. Independent verification accepted the Git-baseline-disabled repair: application-owned `isolated-copy` excludes `.git` directories and worktree `.git` files when disabled, preserves them when enabled, and `rerun-from-step` reloads the current configuration and clears stale `workspaceGit`. Focused verification passed `2 files / 131 tests`, `npx tsc --noEmit`, and a real temporary-directory copy probe. ACPX's own `.git` stat/file behavior remains a separate runtime-tracing gap.
- Task 10 is done at 100%. The final configured gate passed: `npm test` `160 files / 1047 passed / 6 skipped`, component-jsdom `29 files / 132 passed`, Playwright `5 passed`, and `npx tsc --noEmit` passed. Port `5188` had no stale service, `PLAYWRIGHT_BASE_URL` was unset, and E2E started against the current `dist` through `start:start`. `Scheduler restore skipped` is retained as a non-failure runtime notice.
- Task 11 is done at 100%. Independent review accepted the visible AI action, all creator-entry routes, session reuse/resume, server validation, and final lightweight payload without reviving a persisted `ai-guided` mode or legacy plugin. Focused evidence: `11 files / 100 passed`.
- Task 12 is done at 100%. System settings no longer expose the Memory V2 frontend tab/UI. System CLI environment variables are embedded directly in the `SystemSettingsContent` `environment` section through the shared `EnvVarsEditor` inline; there is no system dialog, edit button, or `systemEnvDialogOpen` state. Personal CLI environment variables still use the global `EnvVarsDialog` with Claude, Codex, OpenCode, and other CLI tabs; the password `ObjectEditDrawer` remains. ACPX resolves `personal > system > host`: an unset personal value uses the system value, and when both configured layers are unset, acpx inherits the host value. Empty, null, undefined, or disabled entries cannot replace a valid lower-layer value. Startup and reconnect both read the latest configuration. The final focused rerun is `2 files / 36 passed`; the separate agent-reported complete coverage is `3 files / 45 passed`, including provider coverage and trace redaction. The two unreferenced frontend Memory V2 UI files and the AccountPage avatar explanation were removed; backend `memory-v2` remains available.
- The Windows test-environment cleanup repair is recorded as passing across 3 files and 34 tests. This closes the reported SQLite/temp-directory cleanup cluster only; it does not close the full-suite gate.
- The Git-baseline-disabled application path is accepted. This does not establish that ACPX itself performs no `.git` file access; that process-level behavior remains a separately tracked runtime-tracing follow-up.
- Frontend memory-handoff and Werewolf UI surfaces are removed; necessary detailed logs remain backend-visible, while the frontend should show only the required summary.
- Task 13 is done at 100%. Final independent verification passed `11 files / 225 tests` and `npx tsc --noEmit`. Normal failed checkpoints, explicit force/rerun recovery, live history synchronization, ACPX cleanup, and rerun-attempt audit retention are accepted. Real Linux process-tree execution remains an environment-specific integration test gap, not a known behavioral failure.

The board currently represents 13 tasks done. The Task 10 final configured gate supersedes the earlier historical full-suite evidence.

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

## Latest Coordinator Snapshot

As of `2026-07-30 17:13:10 +08:00` (final archive):

- AI-entry implementation is now reported complete at the focused level: `WorkflowModeSelector` exposes the third `AI 引导创建` card; clicking it enters lightweight `NewConfigModal` creation and creates/reuses the session; `WorkflowsPage` and `ChatPageContent` are connected. The AI-entry focused set is `15/15` passing.
- Latest Task 12 focused evidence: the final rerun passed `2 files / 36 passed`; the separate agent report passed `3 files / 45 passed` with provider coverage and trace-redaction assertions; `npx tsc --noEmit` passed.
- Latest Task 12 UI evidence: `SystemSettingsContent` renders system CLI environment variables inline in its `environment` section through shared `EnvVarsEditor`; the system dialog, edit button, and `systemEnvDialogOpen` state are absent. Personal CLI environment variables still use the global `EnvVarsDialog`. `npx vitest run tests/components/EnvVarsDialog.test.tsx --environment jsdom` passed `1 file / 3 passed`.
- Latest local real gate after the inline UI change: `npm run test:components` passed with `29 files / 131 passed / 0 failed / 0 skipped`; `npm test` passed with `158 files / 1005 passed / 0 failed / 6 skipped`; `npm run test:e2e` passed with `5 passed / 0 failed / 0 skipped`; `npx tsc --noEmit` exited with code 0.
- Cleanup boundary verified: `MemoryV2DiagnosticsPanel.tsx` and `MemoryV2GovernancePanel.tsx` are deleted, `AccountPage.tsx` no longer contains the avatar internal explanation, and backend `memory-v2` remains retained. No residual match was found for the deleted UI names or specified copy.
- Additional recorded focused evidence: ModelDiagnostics `16/16`; API/mock repair cluster `3/3`; `api-workspace-routes.test.ts` `6 passed / 4 skipped`; Agora `18/18`; `WorkspaceDirectoryPicker` `1/1`; `AgentEditModal` `1/1`; Windows cleanup `3 files / 34 tests`. Task 8 independently accepted the Git-baseline-disabled repair with `2 files / 131 passed`, TypeScript, and a real temporary-directory probe covering disabled directory/worktree `.git` exclusion and enabled compatibility.
- Workbench dynamic-import verification is now complete: focused test `2/2`; `npx vite build -c vite.start.config.mts` succeeded (client 8005 modules, SSR 970 modules); `npx tsc --noEmit` passed; clean dev server `http://127.0.0.1:5187` returned `200` for `/login`, the Workbench route, and the exact module URL; browser `import('/src/client/pages/workbench/WorkbenchClient.tsx')` resolved to a function with no `5xx/503`.
- Task 13 is accepted at `100%`: final independent verification passed `11 files / 225 tests` and TypeScript. `rerun from step` is a visible explicit action, force recovery is preserved without weakening ordinary failure gating, historical rerun attempts remain backend-readable as `superseded`, history links stay live, and cleanup diagnostics remain backend-only. Real Linux process-tree execution remains an environment-specific integration test gap.
- Task 10 is accepted at `100%`: `npm test` passed `160 files / 1047 passed / 6 skipped`; component-jsdom passed `29 files / 132 passed`; Playwright passed `5`; and TypeScript passed. E2E used the current `dist` through `start:start` with no residual `5188` service and no `PLAYWRIGHT_BASE_URL`. `Scheduler restore skipped` remains a non-failure runtime notice. Task 12 remains `Done` at `100%` within its settings boundary.

## Overview

| Progress | Task | Status | Depends On | Execution | Notes |
|----------|------|--------|------------|-----------|-------|
| 100% | Task 1: Core contract and state-machine-only runtime | Done | None | Parallel wave 1 | Core contract and runtime handoff is marked done; final workstream verification remains separate. |
| 100% | Task 2: Remove legacy command and creation plugins | Done | None | Parallel wave 1 | Legacy `/workflow` and dedicated creation-plugin paths are reported removed; generic chat and runtime APIs remain in scope. |
| 100% | Task 3: Rename and lock tasklist skills | Done | None | Parallel wave 1 | Canonical `aceharness-tasklist` identity and caller-owned tasklist directory contract are documented. |
| 100% | Task 4: Document roots and output display | Done | Tasks 1, 3 | Parallel wave 2 | Source-aware task documents and persisted runtime outputs are reported integrated; final audit remains open. |
| 100% | Task 5: Lightweight creation and design UI | Done | Tasks 1, 2, 3 | Completed | Independent review passed `8 files / 60 tests`; fixed lightweight topology, AI creator-session handoff, mode boundary, and lightweight child labeling are accepted. |
| 100% | Task 6: Runtime session and Agora backend removal | Done | Tasks 1, 2, 3 | Parallel wave 2 | Ordinary conversation binding, workflow event persistence, and workflow-room removal are reported complete. |
| 100% | Task 7: Workbench runtime integration | Done | Tasks 4, 5, 6 | Completed | Independent review passed `4 files / 19 tests` plus Task 13 integration `5 files / 178 tests`; Vite build and TypeScript passed. |
| 100% | Task 8: Static audit and documentation sync | Done | Tasks 7, 9, 11, 13 | Completed | Static/AI-entry audit and Git-baseline-disabled repair are independently accepted: disabled isolated-copy excludes directory/worktree Git metadata, enabled compatibility remains, and rerun reloads the current gate. ACPX self-behavior remains a runtime-tracing follow-up. |
| 100% | Task 9: Subworkflow result propagation regression | Done | None | Parallel wave 3 with Task 7 | The task document reports the focused manager suite at 107/107 and preserves the five regression assertions. |
| 100% | Task 10: Full test-suite gate | Done | Task 8 | Completed | Final configured gate passed: Vitest `160 files / 1047 passed / 6 skipped`, components `29 files / 132 passed`, E2E `5 passed`, and TypeScript. E2E used current `dist` via `start:start` with no stale `5188` service. |
| 100% | Task 11: Retain AI-guided workflow creation | Done | Tasks 2, 5 | Completed | Independent session/payload review passed `11 files / 100 tests`; all retained AI entry routes converge on validated lightweight creation without legacy mode/plugin revival. |
| 100% | Task 12: Settings, environment precedence, CLI injection, and positive copy cleanup | Done | Tasks 8, 10 | New follow-up | System CLI variables are inline in `SystemSettingsContent` via shared `EnvVarsEditor`; personal CLI variables remain in the global `EnvVarsDialog` modal. Latest UI focused test `1 file / 3 passed`; component gate `29 files / 131 passed`; `npx tsc --noEmit` passes. Final focused rerun `2 files / 36 passed`; separate agent coverage `3 files / 45 passed`; latest local `npm test` `158 files / 1005 passed / 0 failed / 6 skipped`, E2E `5/5`. Two unreferenced frontend Memory V2 UI files and the AccountPage avatar explanation were removed; backend `memory-v2` was retained. |
| 100% | Task 13: Workflow failure gating, live history sync, and stop cleanup | Done | None | Completed | Final independent verification: `11 files / 225 passed`; TypeScript passed. Explicit recovery, current-attempt isolation, history sync, and run-scoped cleanup are accepted; real Linux process-tree integration remains an environment-specific test gap. |
