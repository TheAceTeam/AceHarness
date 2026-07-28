# Recommended Implementation Order

This sequence is intentionally organized for delegated implementation. The main Agent coordinates, reviews, and updates progress; it does not make runtime-code edits.

## Phase A: Serial Foundation

1. Dispatch and finish Task 1 first. It owns the empty V2 SQLite store, public contracts, authorization snapshot model, index/detail query boundary, and handoff persistence primitives.
2. Hold a contract review gate after Task 1. The implementing Agent must provide the exported type/API list, schema/migration list, affected file list, static evidence, and unresolved assumptions. No downstream Agent may invent or alter those interfaces independently.

## Phase B: Parallel Consumers Of The Frozen Contract

After the Phase A contract is reviewed and accepted, dispatch these three tracks concurrently:

1. Task 2 owns AI-facing decision parsing, native-tool/fallback parity, prompt manifest construction, and explicit detail-read handling.
2. Task 3 owns phase and state-machine workflow handoff integration, run/channel reconstruction, required-read blocking, and artifact-reference replacement for raw output tails.
3. Task 4 owns chat and collaboration consumer cutover, legacy route retirement, archive registry wiring, and session/run continuity. It consumes the Task 1/2 public interfaces and must not change workflow execution paths owned by Task 3.

Each parallel track must stop and report rather than editing another track's owned files. The main Agent resolves interface conflicts through a bounded follow-up task or a serial integration patch.

## Phase C: Serial Integration And Governance

1. Review all three Phase B diffs together for schema/API drift, accidental legacy access, prompt detail leakage, duplicate consumer behavior, and ownership conflicts.
2. Dispatch Task 5 only after that review. It owns removal of the Agent-management memory editor, governance/audit/review UI, workflow handoff UI, diagnostics, and staged-cutover controls.
3. Run a final static review and documentation reconciliation after Task 5. Do not enable a consumer based on an unreviewed parallel change.

## Execution Constraints

- Per user direction, do not run build or test commands in this workstream. Record static inspections and all missing runtime proof in `verification-log.md` and `verification-gaps.md`.
- Preserve all pre-existing unrelated worktree changes. Do not reset, restore, reformat, or rewrite them.
- Legacy content may never be imported, attached, queried, searched, summarized, used as a fallback, or exposed through a V2 endpoint.
- Task completion is a review state, not merely an edited-file state. The main Agent updates a task to `Done` only after its acceptance surface and handoff report are reviewed.

## Required Gates

- No workflow consumer may switch to V2 reads until handoff resume tests pass.
- No writer may infer retention or delivery from a business issue label; protocol contract tests must pass before V2 capture is enabled.
- No consumer may switch to V2 reads until tests prove default manifest/search/handoff queries never join detail bodies, stay inside total index-character limits, and fail closed for required-read overflow.
- No workflow consumer may switch to V2 reads until lifecycle-anchor isolation, participant/channel authorization, retry/cancellation/subworkflow handoff receipts, and resume reconstruction pass.
- No V2 consumer may use a legacy memory reader, fallback, importer, or projection; empty-store and zero-legacy-access checks must pass before consumer enablement.
- No `auto` long-memory mode may become default until the product decision is explicitly locked and redaction, ownership, duplicate, revision, review-action, and audit checks pass.
- Before V2 disable/re-enable is declared safe, new V2 records must remain intact and legacy archive hashes must remain unchanged; disabling V2 must not revive legacy memory reads.
