# Memory V2 Task List

Updated: 2026-07-25

This document is based on the current memory and workflow-context audit, [PRD.md](PRD.md), `src/lib/workflow/memory-store.ts`, `src/lib/agent/memory-resolver.ts`, `src/lib/chat`, `src/lib/workflow/manager.ts`, and `src/lib/state-machine/workflow-manager.ts`. It is an implementation plan and acceptance checklist for a unified, SQLite-backed short-term and long-term memory system.

## Entrypoints

- [Product requirements](PRD.md)
- [Design locks](00-design-locks.md)
- [Memory decision and handoff protocol](memory-decision-and-handoff-protocol.md)
- [Recommended implementation order](implementation-order.md)
- [Agent dispatch board](agent-dispatch-board.md)
- [Current verification gaps](verification-gaps.md)
- [Recent verification](verification-log.md)
- [Out of scope](out-of-scope.md)

## Task Documents

- [Task 1: SQLite Schema And Memory Service](01-sqlite-schema-and-memory-service.md)
- [Task 2: AI Memory Decision And Retrieval Protocol](02-ai-memory-protocol-and-retrieval.md)
- [Task 3: Workflow Handoff And Context Replacement](03-workflow-handoff-and-context.md)
- [Task 4: Consumer Cutover And Fresh Start](04-consumers-and-legacy-migration.md)
- [Task 5: UI, Governance, Observability, And Cutover](05-ui-governance-observability-and-cutover.md)

## Current Judgment

- `memory.sqlite` already persists role, project, workflow, and chat records, but it retrieves by recency and injects text directly; `runtimeEnabled` controls read injection while automatic writers still persist records.
- The state-machine manager writes final review/experience data but only injects raw tails from the prior two states. It has no automatic handoff for normal serial steps within the same state.
- `channelOutputsById` is process-local and is not present in persisted run state, so it is lost during resume.
- Lightweight tasklist and state-machine workflows use the same V2 handoff query contract.
- Workflow short memory must span the complete `run` and remain available across authorized participating Agents; the source Agent is provenance only.
- Every short record needs a unique session/run lifecycle anchor. Relevance bindings cannot widen it into another conversation or run.
- Existing YAML experience and relationship stores are legacy sources outside Memory V2. V2 starts empty and never imports or reads them as memory.
- The current Agent management dialog exposes direct memory read/edit/clear controls. Memory V2 removes that UI without migrating its data; new AI decisions and server governance apply only to newly created V2 records.
- Correct resume-safe handoff requires persisted batches, deliveries, versioned read receipts, participant/channel snapshots, and typed artifact references, not just a memory row.
- B-R1 static review passed: ordinary `handoff: none` session-short records now remain eligible only in their own session manifest; frozen delivery records still use their resolved target path.
- Task 2 wraps HTTP Agent Chat execution with the V2 native-tool/structured-fallback protocol, and Task 3 now invokes the same protocol contract from both workflow runtimes.
- Gate B-R static review accepted the workflow protocol repair: each actual workflow attempt has a server-issued event, only same-event successful active proposals may be handed off, atomic target/receipt emission is service-owned, and fallback control blocks do not reach workflow streams or visible output.
- Task 4 static review accepted removal of old-content status/Workbench, Agent-draft, configuration-generation, and recommendation readers. No unauthenticated V2 replacement was added; runtime zero-access evidence remains open.
- Task 4C static review accepted homepage non-stream and stream capture through `AiMemoryV2EngineAdapter`, owner-bound frontend-session resolution, and removal of browser `workingDirectory` as a Memory V2 project grant or prompt-history source.
- Task 5 static review accepted the removal of Agent-memory CRUD, index-only governance and handoff surfaces, explicit versioned detail reads, and server-driven pagination with no 10,000-record tail.
- Per user direction, this workstream does not run build or test commands. Agents record static evidence and any unproven behavior in the verification documents instead.

## Overview

| Progress | Task | Status | Notes |
|---|---|---|---|
| 100% | Task 1: SQLite Schema And Memory Service | Done (Static) | Gate A, B-R1, and B-R4 passed static review. Atomic resolved handoff emission and retry-target receipt reissue are available; runtime proof remains tracked separately. |
| 100% | Task 2: AI Memory Decision And Retrieval Protocol | Done (Static) | Agent Chat non-stream, stream, and channel execution use the V2 wrapper with server-validated workflow identity. Workflow runtime integration is owned by B-R3b; runtime provider behavior remains unproven. |
| 100% | Task 3: Workflow Handoff And Context Replacement | Done (Static) | Both managers execute the V2 protocol, use atomic server-owned handoff emission, retry receipts, and fail-closed bounded fallback continuation. Runtime behavior remains unproven. |
| 100% | Task 4: Consumer Cutover And Fresh Start | Done (Static) | Task 4C completed homepage protocol capture, owner-bound session identity, and server-derived V2 scope repair; runtime continuity and zero-access proof remain open. |
| 100% | Task 5: UI, Governance, Observability, And Cutover | Done (Static) | 5A, 5B, and 5C are statically accepted. Governance/handoff pagination is server-driven with no fixed 10,000-record tail, and list responses remain index-only. |
