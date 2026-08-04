# Task 1: Core Contract And State-Machine-Only Runtime

Status: Done

## Execution Contract

- Depends on: None.
- Unlocks: Tasks 4, 5, and 6.
- Execution: Parallel wave 1.
- Delegated owner: Child Agent A.
- Scope boundary: Own server/core workflow contracts only: schemas, validation, registry, phase executor removal, state-machine runtime skill handling, run-state types, and crash-recovery imports. Do not edit home/plugin UI, document API/UI, skill directories, or Workbench UI.

## Goal

Make state-machine the only workflow runtime and introduce a validated lightweight profile with enforced step-level tasklist skills.

## Current State

- `UnifiedWorkflowConfig` still accepts phase-based configurations and the registry still constructs `WorkflowManager`.
- `WorkflowStep.skills` exists but is marked deprecated; runtime prompt and workspace skill sync omit it.
- The state-machine manager imports engine-selection helpers from the legacy phase manager.

## Follow-Up Work

- Remove phase-based schema/type branches and legacy manager routing, extracting any shared engine-selection helpers into a neutral module before deletion.
- Add the lightweight profile contract and validate its exact state/step shape, no transitions, required tasklist directory, and mandatory `aceharness-tasklist` step skill.
- Restore effective step-level skills in prompt injection and workspace synchronization; required lightweight skills must survive inherited child context overrides.
- Persist enough lightweight run metadata for resume and document resolution without reading live configuration files.
- Ensure subworkflow dependency validation permits a lightweight state-machine child but rejects a lightweight workflow that contains any subworkflow step.
- Remove the residual phase-based registry test fixture. Do not replace it with a test that asserts rejection of a removed workflow type; removal is covered by final residual-reference audit.

## Acceptance

- No runtime path can create or select the phase executor.
- Malformed lightweight configurations fail validation with actionable field paths.
- A valid lightweight configuration uses one state, one agent step, no transitions, and effective skills always include `aceharness-tasklist`.
- Generic agent steps retain independently persisted `step.skills` semantics.
- No core import still depends on the deleted legacy manager.
- No dedicated test fixture or assertion retains `phase-based` as a supported or rejected workflow-mode contract.

## Verification Record