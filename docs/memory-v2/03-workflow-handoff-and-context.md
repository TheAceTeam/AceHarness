# Task 3: Workflow Handoff And Context Replacement

Progress: 100%
Status: Done (Static)

## Goal

Replace raw prior-output injection with unified, protocol-driven short-term handoffs scoped to the complete workflow run. They remain available across all authorized Agents in that run, while later steps receive only the summaries addressed to them and retrieve details when needed.

## Current State

- Lightweight tasklist workflows and state-machine workflows use the V2 handoff manifest for workflow context.
- The manifest carries bounded index metadata and explicit detail reads instead of injecting raw output tails by workflow mode.
- Same-state serial steps have no automatic output transfer across different Agents.
- Channel output is held in a process-local Map and is lost on resume.
- The V2 handoff adapter is integrated with the active lightweight tasklist and state-machine runtimes, including resume and final handoff paths.
- Gate B static review covers the active workflow runtimes and the fresh-start feature gate. The state-machine finalization path also still writes legacy `appendMemoryEntries`, and no engine integration currently persists AI memory decisions before the handoff parser consumes their IDs.
- B-R3b now creates one Task 2 protocol turn per actual workflow attempt, captures only server-observed active create/upsert results from that attempt event, and permits handoff references only from that ledger. Both managers use atomic `emitResolvedHandoffBatch`, reissue retry target receipts, and suppress raw fallback stream output. The fallback loop supports bounded search-to-read continuation and terminal mutation-only persistence; terminal reads/searches fail closed.

## Follow-Up Work

- Define the required `handoff` result shape: an explicit no-op or references to validated memory decisions, overall summary, delivery target/mode, status, next action, verification state, and typed artifact references.
- Persist one handoff batch for every source step attempt, including no-op, emitted, failed, cancelled, retrying, and child-to-parent states. Parse and validate handoffs after every step; request a bounded repair result when a required final handoff is missing or malformed.
- Write run-wide, cross-Agent delivery rows plus selected short/long memory IDs and first-level index fields in one transaction; freeze resolved targets and detail revisions per source attempt. Do not duplicate every source output into a handoff payload, detail record, or source-Agent-only bucket.
- Replace state-machine prior-state output scans with `buildManifest({ run, workflow, project, agent, state, step })`.
- Keep all active workflow context assembly on the same manifest query.
- Persist channels as explicit `run + channel` scope bindings with server-derived channel membership and remove dependence on `channelOutputsById` for correctness.
- Make child workflow completion create a new parent-run handoff batch rather than forwarding raw child output or reusing the child manager's in-memory state.
- Persist required-read receipts by target step attempt, Agent, detail revision, extract hash, and failure state. A receipt failure moves the target to `handoff-blocked` and supports retry, Supervisor/manual handling, reclassification, or fail-step.
- Preserve new raw output paths only through typed, path-validated artifact references for explicit investigation; never use historical output as a V2 memory fallback.
- Make workflow V2 initialization honor the shared fresh-start readiness gate, retire the remaining legacy `appendMemoryEntries` write, and integrate the Task 2 execution protocol so memory IDs in `<memory-handoff>` can only reference decisions actually persisted through V2.
- No implementation follow-up remains inside the Task 3 ownership boundary. Runtime engine execution, cancellation, SQLite rollback/concurrency, retry/channel authorization, and subworkflow behavior remain explicit verification gaps.

## Acceptance

- A different Agent running the next serial step in the same state queries the same run-wide short-memory source and receives only matching manifest handoff summaries.
- A required-read handoff blocks the addressed target until it reads the bounded detail payload, while an on-demand handoff never appears in its normal manifest.
- Handoff eligibility survives Agent changes, state changes, and resume for the complete run while its retention, target, and read conditions remain active.
- A resumed workflow reconstructs channel and handoff context without in-memory state.
- Lightweight tasklist and state-machine workflows produce the same handoff contract and consume the same manifest contract.
- Retry, cancellation, branch, child workflow, required-read denial/timeout, and stale revision behavior are explicit persisted states rather than inferred from raw output or the current manager instance.

## Verification Record

- 2026-07-24: Assigned after Task 1 Contract Gate A acceptance. Per user direction, no build or test command will be run; the Agent must return static workflow-path evidence and runtime gaps.
- 2026-07-25: Gate B static review found `appendMemoryEntries` remains in `src/lib/state-machine/workflow-manager.ts` finalization and `createWorkflowMemoryV2Adapter` bypasses `ensureMemoryV2FreshStart`. These are blocking cutover defects; no build, lint, or test command was run.
- 2026-07-25: B-R3 initial static repair removed the identified legacy writer and applies the shared fresh-start gate before V2 adapter creation in both managers. It is not accepted yet: workflow execution does not pass through the Task 2 Agent Chat wrapper, and `completeStep()` has no server-observed proposal-reference check. B-R3b is required; no build, lint, or test command was run.
- 2026-07-25: B-R3b static review accepted. Both workflow managers prepare Task 2 turns per actual step, persist only same-event active proposal references through the atomic Task 1 batch API, reissue retry target receipts, and keep fallback control blocks out of streams/output/errors. The bounded fallback chain supports `search -> read -> terminal proposal`; a terminal read/search is rejected before any fallback call mutates state. No build, lint, or test command was run; runtime proof remains tracked separately.
