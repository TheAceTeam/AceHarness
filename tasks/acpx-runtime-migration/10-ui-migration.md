# Task 10: UI Migration For Engines, Models, Chat, Settings

Progress: 0%
Status: Pending

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

- Not run yet.
