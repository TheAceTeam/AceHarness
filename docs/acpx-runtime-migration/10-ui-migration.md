# Task 10: UI Migration For Engines, Models, Chat, Settings

Progress: 100%
Status: Done

## Goal

Move existing UI surfaces to runtime concepts while preserving current navigation, components, and visual style.

## Current State

- `/engines`, `/models`, settings, Chat, Skills, and MCP already exist.
- Spec requires no new acpx-specific control panel and no visible acpx state in Chat UI.
- Existing UI components and theme tokens should be reused.

## Follow-Up Work

- Update `/engines` to show Agent cards, model route, env readiness, permission policy, availability, and diagnostics summary.
- Remove SDK/stdio driver controls and replace old driver slot with “接入方式：Runtime Adapter”.
- Update `/models` tabs to catalog/routes/probes/diagnostics while displaying user-friendly “模型路线” labels.
- Add compact/fork to session menu or message menu, not as Composer-heavy controls.
- Add permission/env/secret controls under existing settings sections.
- Preserve Skills/MCP UI while adding runtime snapshot/readiness behavior underneath.

## Acceptance

- `/engines` still appears as “引擎管理”.
- Chat UI displays running/queued/canceling/failed but not acpx record id, provider session id, lease owner, raw status, stderr, auth id, or heartbeat.
- Default `unrestricted` permission state is visible in `/engines` or settings and can be tightened.
- UI uses existing components and theme tokens without introducing a separate Runtime console style.

## Verification Record

- 2026-07-09 UI migration slice A:
  - `/engines` header remains “引擎管理”.
  - Engine cards were migrated toward Agent/runtime adapter language: Agent id, model route, env readiness, unrestricted permission policy, availability, and diagnostics summary are visible.
  - SDK/stdio driver buttons were removed from the engine page UI; the old driver slot now reads “接入方式：Runtime Adapter”.
  - Engine page does not render acpx record id, provider session id, lease owner, raw status, stderr, auth id, or heartbeat.
  - `unrestricted` is visible as the default permission policy and has a visible entry point for tightening.
  - Verification: `npx tsc --noEmit --pretty false` passed.
- 2026-07-09 UI migration slice D:
  - Settings Runtime section now includes permission/env/secret runtime controls without creating a separate Runtime console.
  - Default `unrestricted` permission policy is visible and can be tightened to `deny-destructive` or `ask`; the selected default policy is saved through system settings.
  - Env/secret profiles are shown as readiness summaries with missing keys and conflict metadata only. Secret values, raw auth ids, provider ids, acpx ids, and native ids are not rendered.
  - Verification: `npx tsc --noEmit --pretty false` passed after concurrent model-page edits were completed. No focused settings tests were found.
- 2026-07-09 UI migration slice B:
  - `/models` UI now uses `catalog / routes / probes / diagnostics` concepts with user-facing labels `模型目录 / 模型路线 / 探针监控 / 诊断评测`.
  - Model route rows prefer `modelRouteId` and runtime route semantics; diagnostics selection is model-route-first and displays `Runtime Adapter` as the access method.
  - Diagnostics no longer foregrounds raw `runId=`, `driver=`, or `engine=` detail text in user-facing logs, and missing usage/cost values render as `未返回`.
  - Verification: `npx vitest run tests/api-models-route.test.ts tests/model-routes-sqlite.test.ts tests/model-diagnostics.test.ts tests/model-select.test.tsx` passed, 24 tests. `npx tsc --noEmit --pretty false` passed.
- 2026-07-09 UI migration slice C:
  - Chat header and lightweight modal now show user-facing runtime state labels: `运行中`, `排队中`, `取消中`, `失败`.
  - Chat metadata uses `模型路线` and Agent wording instead of engine-first oldArchitecture wording.
  - Internal session ids were removed from visible subtask cards and workflow-agent sidebar labels.
  - Compact/fork are exposed from the session menu; `/compact` direct text input remains only as a compatibility path and is no longer advertised in the Composer slash menu.
  - No new Runtime console UI was added.
  - Verification: `npx tsc --noEmit --pretty false` passed.
  - Focused chat verification: `npx vitest run tests\components\ChatSidebar.test.tsx tests\components\ChatMessageCardRendering.test.tsx tests\chat-message-preview.test.ts` passed, 25 tests.
- 2026-07-09 Login and Skills layout follow-up:
  - Login failures and captcha-required feedback now use toast notifications; the root already provides `ToastProvider`, so the login page does not add a duplicate provider.
  - Skills local management now matches the Agent management layout pattern: header actions hold `工作目录`, `上传 Skill`, `导出`, and `同步内置`; `PageToolbar` holds search, source filter, sort, view toggle, refresh, and square tag badges in `activeFilters`.
  - Skills toolbar no longer owns upload/export/workspace/sync actions, and tag filtering is no longer a separate card or dropdown-only control.
  - Static audit: compared `SkillsManager.tsx` with `AgentsManager.tsx`; no `MultiCombobox` tag filter remains, local toolbar owns only search/source/sort/view/refresh, and visible tag filtering is centralized in `activeFilters`.
  - Verification: `npx tsc --noEmit --pretty false` passed.
- 2026-07-09 Engines and chat fork follow-up:
  - `/engines` now builds cards from runtime agent registry options instead of the old fixed engine array, so newly registered runtime agents appear in the page.
  - oldArchitecture engine ids are normalized to runtime agent ids for selection and model compatibility, including `claude-code -> claude`, `kiro-cli -> kiro`, and `magic-cli -> cangjie-magic`.
  - Engine cards no longer switch on card click; switching is only triggered by the explicit `切换到此引擎` button.
  - Availability semantics now treat only runtime status `available` as available. `unknown` remains a not-yet-detected state and no longer appears as usable.
  - Claude-specific official alias test controls were removed from the main card flow; available model detection is now presented through the shared card action.
  - Chat session fork now distinguishes group-chat/agora sessions from plain sessions. Group-chat fork keeps topic, roster, messages, and display state, clears `collaborationRoom.agentSessions`, resets runtime/workspace pointers, and prepares a separate agora workspace for the forked session.
  - Verification: `npx vitest run tests/api-engine-old-architecture-routes.test.ts tests/client-engine-availability.test.ts` passed, 10 tests. `npx vitest run tests/chat-context.test.tsx --environment jsdom` passed, 13 tests. Subagents also reported `npx tsc --noEmit --pretty false` passing after their focused changes.
