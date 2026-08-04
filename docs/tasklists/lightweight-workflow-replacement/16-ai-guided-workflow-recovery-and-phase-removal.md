# Task 16: AI-Guided Recovery And Phase-Mode Removal

Status: In Review

Updated: 2026-08-01 16:02:00 +08:00

## Execution Contract

- Depends on: Tasks 5, 7, and 11.
- Unlocks: current acceptance of the retained AI creation entry and the next browser/full-suite gate.
- Execution: serial recovery of the creation surface.
- Scope boundary: audit and reconcile the AI creation entry, mode selector, creator-session handoff, lightweight/state-machine assembly, and legacy phase-mode references. Do not restore a phase executor, old creation plugin, persisted `ai-guided` mode, or edit unrelated runtime/settings surfaces.

## Goal

Restore the AI-guided UI planning entry: the user describes a workflow, the AI planning conversation asks or derives the needed structure, the user confirms the draft, and the server validates and creates a lightweight or state-machine workflow. Selecting the AI radio must select the entry only; it must not create an empty homepage conversation.

## Current Evidence

- The current worktree contains substantial changes in `NewConfigModal.tsx`, `WorkflowModeSelector.tsx`, `WorkflowsPage.tsx`, `ChatPageContent.tsx`, `ChatContext.tsx`, the workflow creator assembly, and the config-create route.
- The earlier AI-entry focused evidence is retained in `verification-log.md`, but it predates the current restoration slice and is not current end-to-end acceptance.
- A user reproduction shows that selecting the AI-guided radio can create an empty conversation in the homepage list before the user submits a requirement. This is an unaccepted regression.
- The prior SSR transform/module-loading issue is user-confirmed resolved on 2026-08-01. It is retained only as historical context and no longer blocks this task.

## Work Items

- Restore the established multi-step AI planning flow and its existing session creation/reuse timing. Creating or reusing a creator session must happen only when the user starts planning, not when the AI radio is selected.
- Keep the two persisted workflow choices and the separate AI planning entry visible and exclusive: lightweight workflow, state-machine workflow, and AI-guided planning. Removing the legacy phase mode must not remove or shortcut the planning flow.
- Ensure the AI result can select either `lightweight` or `state-machine`, while persisted workflow configuration remains limited to those supported modes.
- Remove user-facing phase-mode labels, selectors, templates, and configuration examples within this tasklist's implementation boundary. Preserve generic internal planning data such as `specCoding.phases` when it is not a workflow mode.
- Add focused regression evidence for radio selection without session creation, planning submit/session creation, multi-step continuation, confirmation, lightweight assembly, state-machine assembly, and absence of persisted phase mode.

## Acceptance

- Clicking `AI 引导创建` changes selection state only and does not add an empty conversation to the homepage list.
- Submitting a requirement enters or resumes the established AI planning session and preserves the multi-step planning/confirmation behavior.
- Confirmed AI output creates exactly one supported workflow mode: `lightweight` or `state-machine`.
- No phase-mode selector, phase-mode template, `phase-based` persisted configuration, or legacy creation plugin is restored.
- Focused tests cover the entry, session timing, assembly, and create route; browser verification follows the focused implementation review.
- The task remains `In Progress` until exact focused and browser/full-gate evidence is recorded against the current worktree.

## Resolved SSR Blocker

- The prior startup/module-loading issue is user-confirmed complete on 2026-08-01. It no longer blocks Task 16 acceptance or Task 10 scheduling.

## Verification Record

- 2026-07-31: Task created from the current git state and user-reported AI radio empty-session regression.
- 2026-07-31: Prior focused AI-entry and full-gate results retained as historical evidence; no current acceptance claimed.
- 2026-08-01: Child-agent focused implementation evidence: `tests/components/NewConfigModal.test.tsx` passed `10/10`; the six-file creation-chain set passed `33/33`. The added coverage proves that selecting `AI 引导创建` changes only the exclusive selection state and makes no `/api/chat/sessions` request, while submitting valid requirements creates or restores the planning session and enters clarification.
- 2026-08-01: Coordinator source review confirmed `WorkflowModeSelector` exposes exclusive `lightweight | state-machine | ai-guided` UI choices; `ai-guided` remains UI planning state only, and confirmed output selects a supported persisted workflow. The create-route regression rejects persisted `ai-guided` and `phase-based`; `rg -n "phase-based|workflow\\.phases" src tests` found only negative assertions in focused tests.
- 2026-08-01 residual cleanup: a single display-mode mapper now emits only `轻量工作流` or `状态机`; all prior linear fallbacks in previews, references, and recommendations use it. `configs/README.md` now documents only the lightweight and state-machine configuration contracts, including the correct difference in step-level Skills. `specCoding.phases` remains internal planning data.
- 2026-08-01: `npx vitest run tests/components/NewConfigModal.test.tsx tests/components/WorkflowModeSelector.test.tsx tests/components/WorkflowsPage.test.tsx tests/api-configs-create.test.ts` passed `4 files / 28 tests`. Phase identifiers remain only as negative API-rejection assertions.
- Remaining: browser smoke of radio selection, requirement submission, plan continuation, and confirmed lightweight/state-machine creation against the current worktree; then shared final gate.
