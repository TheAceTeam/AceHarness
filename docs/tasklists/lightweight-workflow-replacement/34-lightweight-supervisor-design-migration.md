# Task 34: Lightweight Supervisor Design Migration

Status: Done

## Execution Contract

- Depends on: Task 21, Task 24 lightweight runtime/design contracts.
- Unlocks: None known.
- Execution: Serial fix for design save validation.
- Delegated owner: implementation agent.
- Scope boundary: `src/lib/workflow/lightweight.ts`, lightweight design policy roster usage in `WorkbenchClient.tsx`, config save/validate normalization routes, design save payload helper, focused tests, and direct lightweight user-config migration. Do not edit README, `implementation-order.md`, backend token files, or state-machine workflow configs.

## Goal

Make lightweight workflow design saves ignore historical `workflow.supervisor` data so lightweight workflows do not display, submit, or persist `default-supervisor`, while ordinary state-machine workflows keep their supervisor configuration.

## Root Cause

- `validateWorkflowDraft()` intentionally rejects `workflow.supervisor` when `workflow.profile: lightweight`.
- The lightweight design surface already hides supervisor controls.
- The design save payload could still be rebuilt from an older stored config that contained `workflow.supervisor`, so validation failed even though the lightweight UI no longer exposes that field.
- The Workbench engine policy roster unconditionally appended `workflow.supervisor`, a supervisor role, or `default-supervisor`, so lightweight workflows could still show a hidden supervisor policy row after the config field was migrated away.
- Historical lightweight configs could also carry `context.executionPolicy.agentOverrides.default-supervisor`, which needed to be removed during lightweight normalization to avoid hidden residual policy state being saved again.
- Historical config `C:\Users\Shawn\AppData\Roaming\ACEHarness\configs\workflow-20260801-1159-pbh1.yaml` had `workflow.profile: lightweight` and `workflow.supervisor.agent: default-supervisor`.

## Completed

- Added lightweight-only normalization that removes `workflow.supervisor` without changing ordinary state-machine configs.
- Extended lightweight normalization to remove `context.executionPolicy.agentOverrides.default-supervisor` while preserving non-supervisor overrides.
- Added a shared policy-agent roster helper so lightweight workflows list only actual step agents, while ordinary state-machine workflows still include supervisor fallback.
- Applied normalization at design save payload construction, config GET, config POST, and config validate entry points.
- Preserved existing lightweight tasklist path helpers and the runtime/design behavior that strips stale `specTaskBinding` from lightweight execution steps.
- Scanned `C:\Users\Shawn\AppData\Roaming\ACEHarness\configs` for YAML configs with `workflow.profile: lightweight`.
- Removed only `workflow.supervisor` from `C:\Users\Shawn\AppData\Roaming\ACEHarness\configs\workflow-20260801-1159-pbh1.yaml`.
- Left all state-machine configs with supervisor untouched.

## Acceptance

- Lightweight design save payloads created from historical configs omit `workflow.supervisor`.
- Lightweight engine policy agent lists omit `default-supervisor` and supervisor-role fallback.
- Ordinary state-machine engine policy agent lists still include supervisor fallback.
- Lightweight save normalization removes residual `context.executionPolicy.agentOverrides.default-supervisor`.
- Config POST can save a historical lightweight payload containing `workflow.supervisor`, and persisted YAML omits that field.
- Config POST preserves `workflow.supervisor` for ordinary state-machine workflows.
- Config validation endpoint accepts historical lightweight payloads after entry-point normalization.
- State-machine validation behavior and runtime supervisor semantics remain unchanged.

## Verification Record

- `node -e "<YAML-aware config scan>"`: found only `workflow-20260801-1159-pbh1.yaml` as lightweight with supervisor before migration; after migration it reports `supervisor=NONE`.
- `node -e "<YAML-aware config scan>"`: after final migration scan, `workflow-20260801-1159-pbh1.yaml` reports `supervisor=NONE` and `defaultOverride=NONE`.
- `npx vitest run tests/workflow-design-config-draft.test.ts tests/api-config-routes.test.ts tests/components/LightweightWorkflowDesignPanel.test.tsx`: pass, 3 files / 19 tests.
- `npx tsc --noEmit`: pass.
