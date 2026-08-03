# Task 24: Lightweight Design Integration Cleanup

Status: Done

## Execution Contract

- Depends on: Task 19
- Unlocks: Task 19 final acceptance
- Execution: Parallel wave 11 follow-up
- Delegated owner: Child agent
- Scope boundary: `src/components/LightweightWorkflowDesignPanel.tsx`, `src/components/StateMachineDesignPanel.tsx`, and `tests/components/LightweightWorkflowDesignPanel.test.tsx` only.

## Goal

Complete the step-Skills removal without hiding stale callers behind an unrestricted props type, and update the focused component contract accordingly.

## Current State

- `StateMachineDesignPanel` still passes `availableSkills` to the lightweight panel.
- The lightweight panel currently accepts arbitrary extra props solely to mask that stale call.
- Focused tests still query and mutate the removed `步骤 Skills` control.

## Follow-Up Work

- Remove the stale prop at the design-panel call site.
- Restore an explicit lightweight-panel props interface without an index signature.
- Update focused tests to assert no step-Skills control and fixed internal tasklist skill after edits.

## Acceptance

- The lightweight panel has a strict prop contract with no `availableSkills` prop or arbitrary property escape hatch.
- The design container compiles against that contract.
- Focused tests prove the removed control is absent and all edits retain only `aceharness-tasklist`.

## Verification Record

- `npx vitest run tests/components/LightweightWorkflowDesignPanel.test.tsx`: passed, `1 file / 3 tests`.
- Coordinator review: accepted. The panel now has an explicit strict props contract, the design-container call no longer passes `availableSkills`, and the test verifies the hidden control plus forced internal Skill behavior.
