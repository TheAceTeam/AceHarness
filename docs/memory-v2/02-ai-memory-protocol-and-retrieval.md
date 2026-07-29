# Task 2: AI Memory Decision And Retrieval Protocol

Progress: 100% (static)
Status: Done (Static Review)

## Goal

Let AI classify and request memory safely while making prompt consumption index-first and detail-on-demand.

## Current State

- Agent Chat currently appends chat memory after execution and directly concatenates selected record content into its prompt.
- Homepage chat does not share that resolver path.
- Context compaction changes runtime session IDs, which can orphan chat memory keyed by the prior runtime session.
- The assigned Agent has created an isolated `src/lib/agent/ai-memory-contracts.ts` implementation artifact. It has not yet handed off prompt/engine integration for review.
- The Agent has added isolated V2 contracts, tool/fallback adapters, and index-only prompt assembly modules. It is still integrating the protocol into supported Agent execution paths.
- The Agent has begun integrating the V2 protocol into its owned `memory-resolver.ts`; completion still requires final static handoff and review.
- Gate B static review confirms the protocol modules are transport-neutral only: no supported Agent-chat or workflow execution path calls `prepareAiMemoryEngineTurn`, registers its `nativeTools`, executes its fallback envelope, or checks its required-read gate before work.
- B-R2 wraps actual Agent Chat execution. HTTP non-stream, HTTP stream, and channel callers execute the prepared V2 engine; native tools are used only for engines that explicitly expose a server callback, while normal runtime engines use server-parsed structured fallback and suppress its raw chunks. Workflow step runners remain Task 3 ownership.
- Workflow-shaped Agent Chat input now validates persisted `runId -> configFile` binding and the SQLite participant snapshot before V2 is enabled. Browser step/state identity is not accepted as V2 execution authority; a failed validation disables only V2 for that turn and never enables legacy fallback.

## Follow-Up Work

- Define `memory.propose`, `memory.read`, `memory.search`, `memory.resolve`, and `memory.acknowledgeRequiredRead` native tool contracts based on [the decision and handoff protocol](memory-decision-and-handoff-protocol.md). Keep handoff-target resolution and receipt persistence server-owned even when an engine invokes these tools.
- Provide a structured-result fallback for engines that cannot invoke native tools. The fallback must be parsed server-side and must not be shown as user-facing content.
- Require proposals to independently include retention, unique short lifecycle anchor where applicable, relevance bindings, summary, `readWhen`, handoff mode/target, details, confidence, expiry, source event, and action-specific idempotency/target fields. `create` needs `sourceEventId + idempotencyKey`; `upsert`/`resolve` need a target ID or confirmed fingerprint plus expected detail revision.
- Give the model an explicit decision rubric: discard non-reusable material; use short memory for the current conversation or the entire workflow run; write workflow short memory to the shared run scope rather than the source Agent; use long memory only for durable cross-task knowledge; choose delivery independently from retention.
- Feed a bounded, first-level-index-only manifest to the Agent before it decides what details to read. Include a separately reserved, still total-budgeted required-read control plane; normal candidate overflow may omit lower-ranked rows, while required-read overflow fails preflight.
- Make `memory.search` return index rows only. Make `memory.read(memoryId, detailVersion, cursor?)` re-check authorization, lifecycle anchor, target delivery, revision, and bounded page/extract policy before returning second-level content.
- Add server validation for sensitive content, lifecycle anchors, server-derived owner/workspace/participant membership, allowed lifecycle transition, duplicate fingerprints, expected revisions, required-read extract size, and long-memory governance mode.
- Decouple short-memory continuity from raw runtime session IDs by binding it to frontend session and/or run identity.
- Wire the reviewed protocol into actual engine adapters. Native-tool engines must receive and dispatch only the server-bound tool definitions; non-native engines must parse and strip the structured fallback server-side. Both paths must persist decisions before a handoff references their memory IDs, and must block required reads before task work begins.

## Acceptance

- An Agent can return `discard` or no-op when no reusable information exists.
- An Agent can create a short, run-wide handoff that a different next-step Agent must read and a long project lesson that is only discoverable on demand, through the same protocol.
- Prompt construction contains summaries and IDs but no `details` until an explicit read succeeds.
- A required-read target cannot execute until the bounded detail read and acknowledgement are recorded; an on-demand record stays outside its normal manifest.
- A denied detail read cannot leak another project's or user's memory.
- A compacted/recovered chat can still find its session-scoped short memory.
- Detail over-budget reads use fixed revision cursors for ordinary reads. A required-read denial, timeout, stale revision, unavailable artifact, redaction-to-empty result, or incomplete required extract produces a persisted failed receipt and `handoff-blocked`, not an implicit continuation.
- A model cannot manufacture a different owner, participant list, or visibility scope, and an anchor-mismatched short record cannot appear merely because a project/workflow relevance binding matches.

## Verification Record

- 2026-07-24: Assigned after Task 1 Contract Gate A acceptance. Per user direction, no build or test command will be run; the Agent must return static contract evidence and runtime gaps.
- 2026-07-25: Gate B static review found no call site for `prepareAiMemoryEngineTurn`, `executeNativeTool`, or `executeAiMemoryStructuredFallback` outside the new protocol modules. Task 2 remains in progress until an execution path owns that integration.
- 2026-07-25: B-R2 static review accepted the Agent Chat execution integration. `AgentChatMemoryV2EngineAdapter` owns native/fallback dispatch, fallback control-block stripping, required-read gate checks, proposal-reference capture, and idempotent release; stream and non-stream routes use the prepared wrapper. Workflow runtime is intentionally excluded and remains B-R3b work. No build, lint, or test command was run.
