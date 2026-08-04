# Task 14: ACPX Tool-Result Recovery And Live-Output Regression

Status: In Review (99%; current focused revalidation passed, shared gate pending)

## Execution Contract

- Depends on: None. This is a post-archive corrective task and does not reopen Tasks 1-13.
- Unlocks: coordinator acceptance and the next full test gate for the current worktree.
- Execution: Wave 7. Run 14A and 14B concurrently because their write scopes do not overlap.
- Delegated owners: 14A ACPX adapter child; 14B runtime projection/UI child.
- Scope boundary: keep ACPX adapter work in `src/lib/runtime-agent/adapters/acpx-adapter.ts` and `src/lib/runtime-agent/adapters/acpx-runtime-client.ts` with their adapter tests. Keep projection/UI work in `src/lib/chat/chat-engine-runtime.ts`, `src/components/chat/RuntimeToolEventList.tsx`, and their focused tests. Do not restore file read/write bodies to the live transcript and do not alter the legacy workflow-mode boundary.

## Goal

Every ACPX-routed CLI engine must finish a tool card with the available result or error. Command and search output must remain visible in the structured tool UI. Large file read/write bodies may remain hidden, but their tool lifecycle and completion state cannot disappear.

## Current State

- ACPX `runtime.js` may forward a terminal `tool_call_update` after dropping top-level `output`, `stdout`, `stderr`, and exit-code fields.
- ACPX persists the canonical result under session `tool_results`; the adapter reads that record after the turn settles instead of treating a status-only update as a result.
- The shared runtime projection recognizes `formatted_output`, string, and structured non-file output; rendered coverage proves command/search output remains visible while file bodies remain suppressed.
- The UI auto-collapses terminal cards and groups while rendering recovered command/search results rather than leaving a terminal card with only a generic completion label.
- Coordinator review rejected the first 14A handoff: an `exit_code`-only terminal update can still be missing its persisted output and must not suppress recovery; a meaningful top-level `error` must prevent duplicate fallback completion events.

## Completed Work

### 14A: Adapter Recovery

- Completed status-only terminal-update handling in the ACPX adapter.
- Recovered matching persisted `tool_results` for completed and failed calls, retaining exit status and error information.
- Added regressions for an in-progress call followed by an empty terminal update and for persisted-result recovery.
- Covered `exit_code` plus persisted `formatted_output`, and error-only terminal updates without duplicate fallback events.

### 14B: Projection And UI

- Completed and coordinator-reviewed on 2026-07-31. The handoff normalizes string, `formatted_output`, and structured non-file results; it renders standard output and suppresses file bodies without losing terminal lifecycle state.
- Shared runtime paths normalize string and structured non-file results into the tool result channel.
- Rendered-component coverage proves recovered command/search output appears under standard output while file-content tools do not render large file bodies.
- Chronological tool grouping, completion merge, automatic collapse, and in-body `<ace-process>` stream projection are preserved.

## Acceptance

- An ACPX status-only completed update does not suppress persisted-result recovery.
- A persisted `formatted_output`, string result, structured result, failure, and exit code produce the expected terminal structured tool event.
- Command/search output is visible in the tool card; file read/write content remains suppressed without leaving a Running card.
- The regression applies to the shared ACPX path rather than a Codex-only branch.
- Focused adapter, projection, and component tests pass. The coordinator then runs TypeScript and the configured full test gate before marking this task done.

## Verification Record

- `npx vitest run tests/runtime-adapters.test.ts tests/workflow-runtime-model-route.test.ts tests/components/RuntimeToolEventList.test.tsx`: coordinator rerun passed `3 files / 59 tests` on 2026-07-31 after the 14A and 14B integration.
- `2026-07-31 current focused revalidation`: the same command passed `3 files / 59 tests` against the current dirty worktree. This supersedes the former “revalidation pending” claim, but does not substitute for the shared TypeScript/browser/full-suite gate after Task 16.
- `npx tsc --noEmit`: partial pre-handoff evidence passed; rerun required after child integration.
- `2026-07-31`: two initial child delegations ended before edits because the remote model stream disconnected. No child result or verification evidence was accepted; re-dispatch remains required.
- `2026-07-31 14B child handoff`: focused projection/component suite passed `14/14`. The coordinator reviewed the actual diff; this is task-level evidence, not the final combined acceptance gate.
- `2026-07-31 coordinator review`: rejected the initial 14A handoff pending an `exit_code`-only recovery correction and an error-only terminal-event regression. No Task 14 completion claim is accepted from that handoff.
- `2026-07-31 corrective 14A handoff`: added the required `exit_code`-only persisted-result recovery and error-only terminal-event regressions. The combined focused suite now passes; TypeScript and the current full gate remain required before completion.
- `2026-07-31 final coordinator acceptance`: combined Task 14/15 focused suite passed `7 files / 81 tests`; `npx tsc --noEmit` passed; full Vitest passed `163 files / 1077 passed / 6 skipped` with `--maxWorkers=1`; component jsdom passed `30 files / 137 tests`; Playwright passed `5/5`. Tool events are retained through Memory V2 and serialized back into the live `<ace-process>` transcript, without restoring large file bodies.
- `2026-08-01 current corrective handoff`: shared ACPX event normalization now retains top-level `formatted_output`, `result`, `error`, and `exit_code`; shared result projection carries formatted output and terminal errors into the structured tool result. `npx vitest run tests/runtime-adapters.test.ts tests/workflow-runtime-model-route.test.ts tests/components/RuntimeToolEventList.test.tsx` passed `3 files / 64 tests`; scoped `git diff --check` passed with line-ending warnings only. Coordinator source review confirmed this is the common ACPX adapter/projection path, not a Codex-only branch. Shared gate remains required.
