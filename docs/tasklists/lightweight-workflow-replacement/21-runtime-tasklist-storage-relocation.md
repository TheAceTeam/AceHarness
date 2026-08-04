# Task 21: Runtime Tasklist Storage Relocation

Status: Done

## Execution Contract

- Depends on: Tasks 19 and 22
- Unlocks: None known
- Execution: Serial after Task 22 because startup and recovery files are shared.
- Delegated owner: Child agent
- Scope boundary: lightweight directory derivation, run metadata, runtime document-root resolution, creation metadata, and their focused tests. Do not write generated tasklists into the user project workspace.

## Goal

Store lightweight workflow tasklists and their generated documents in the run-owned runtime data directory instead of `<working-directory>/docs/tasklists/...`.

## Completed

- Lightweight tasklist metadata is now fixed to `tasklist` and recalculates to `<ACE runtime>/runs/<runId>/tasklist` through the shared runtime resolver.
- Formal start, rehearsal, manager start/resume, document roots, creation sessions, and AI assembly consume the run-owned contract; no workspace reservation or fallback path remains.
- Legacy workspace-root metadata is rejected in manager resume and document-root resolution rather than being silently interpreted.

## Acceptance

- Starting a lightweight run creates tasklist documents only below its runtime data root, never in the configured project workspace.
- Resume and document viewing resolve the persisted runtime tasklist location correctly.
- Existing state-machine runtime documents retain their current locations and behavior.

## Verification Record

- 2026-08-01: Initial focused implementation suite passed `6 files / 184 tests`, covering start/rehearsal, resume, document reads, config creation, and AI creation assembly.
- 2026-08-01: Coordinator follow-up found old workspace-relative values in successful-path fixtures. The delegated owner updated successful fixtures to the canonical run-root contract, retaining only explicit ignored-client-override and legacy-rejection cases.
- 2026-08-01: Direct focused suite passed `7 files / 208 tests`. Coverage proves workspace `docs/tasklists` is not created, runtime tasklist documents remain source-readable, a canonical resume succeeds, and legacy resume/document metadata fails closed. Static `rg` confirmed no production `reserveLightweightTasklistDirectory` call/import or workspace-relative runtime derivation remains; scoped `git diff --check` reported only line-ending warnings.
