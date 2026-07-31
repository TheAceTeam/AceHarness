# Task 9: Subworkflow Result Propagation Regression

Status: Done

## Execution Contract

- Depends on: None. The failure is independent of Task 07's Workbench-only scope.
- Unlocks: Task 08.
- Execution: Parallel wave 3 with Task 07.
- Delegated owner: Child agent selected by the coordinator.
- Scope boundary: Own `src/lib/state-machine/workflow-manager.ts` only where subworkflow dispatch maps child terminal status/verdict to its parent result, plus the existing focused test file only when required to keep mocks aligned. Do not weaken, remove, or rewrite the five behavioral assertions; do not edit Workbench/UI, workflow creation, document, or generic runtime-session code.

## Goal

Restore the green-base behavior in which a child workflow that did not pass cannot be reported as a successful parent subworkflow step.

## Current State

- User evidence: after PR 41 merged into `dev`, five assertions under `describe('subworkflow step dispatch')` fail. The same assertions are green at base `649d8894`; PR 41 added test coverage but did not alter those assertion lines.
- Static inspection: the rewritten `executeSubworkflowStep` computes child terminal status, verdict, parent completion, step logs, audit mapping, and thrown error in one path. The defect must be isolated there or in the immediate dispatch/result normalization it calls.
- The provided Vitest reproduction is intentionally not run under the current command constraint.

## Follow-Up Work

- Compare the current subworkflow terminal-status and verdict propagation against base behavior and the existing test fixtures.
- Correct the path that can turn a failed/stopped/crashed child result into a passing parent step or parent verdict.
- Preserve explicit human timeout release as the only intentional override, and preserve conditional-pass verdicts from completed children.
- Use focused static inspection and `git diff --check`; report the unrun Vitest command as a verification gap.

## Acceptance

- A failed, stopped, cancelled, or crashed child produces a failed parent subworkflow step, failure audit/event, and error propagation; legacy `step.result` mappings cannot conceal that terminal failure.
- A completed child keeps its actual terminal verdict, including `conditional_pass`, when that is the deciding parent step.
- The five existing subworkflow-dispatch assertions remain semantically intact; no test is changed merely to accept the regression.
- Task 07 owned Workbench/runtime UI files remain untouched.

## Verification Record