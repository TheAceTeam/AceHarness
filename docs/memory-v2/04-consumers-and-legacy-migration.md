# Task 4: Consumer Cutover And Fresh Start

Progress: 100%
Status: Done (Static)

## Goal

Move every active memory consumer onto a fresh, shared SQLite Memory Service while isolating all old memory stores from V2 reads and writes.

## Current State

- `memory-resolver.ts` is used by Agent Chat and a collaboration-memory endpoint, not by normal workflow execution.
- Generic homepage chat relies on runtime sessions and persisted messages, with a currently unused history fallback.
- Workflow final review data creates both SQLite memory entries and YAML experience files.
- Agent relationship data remains YAML and is used for configuration recommendations.
- Existing `memory.sqlite`, role-memory endpoints, YAML experiences, and relationship files are legacy sources. Memory V2 must not import, query, index, summarize, or use them as a fallback.
- The consumer implementation provides V2 index manifests for homepage/Agent chat and collaboration, retires the legacy Agent-memory route with authenticated `410`, and preserves frontend session identity through Agent-chat requests.
- A Task 4 read-only inventory found a P0 old-content exposure in `src/server/api-routes/workflow/status/route.ts`: it reads old SQLite/YAML memory/experiences and returns full `memoryLayers`, while lacking a trustworthy V2 owner/participant request context. This response cannot be replaced by a generic V2 manifest until a dedicated authenticated handoff/status contract exists.
- The status route no longer imports old memory/experience readers or returns `memoryLayers`; the core status contract and Workbench no longer accept or render those bodies. `finalReview` remains the explicit run-audit artifact.
- Agent draft, configuration generation, and recommendations no longer import or call old memory/experience/relationship stores. Historical response fields are empty only where needed for compatibility, while manually selected reference workflows and static available-Agent recommendations remain.
- Task 4C statically confirms that homepage non-stream and stream execution use `AiMemoryV2EngineAdapter`; the global ChatModal creates an authenticated persisted frontend session before its first V2 turn; and the homepage/collaboration scope builders do not turn a browser `workingDirectory` into `projectIds` or `authorizedProjectIds`.

## Implementation Direction And Remaining Runtime Verification

- Disable every legacy memory reader and writer first, then create `memory-v2.sqlite` as a new empty database only when it does not already exist. Treat the pre-existing `memory.sqlite` and old YAML/files as legacy archives, never as an upgrade source.
- Create a checksum-backed archive registry containing legacy source path, type, content hash, archived timestamp, and retention policy. Legacy archive locations are application-read-only: Memory Service cannot attach their SQLite files, read archive bodies, or resolve archive paths through artifact/detail APIs. The registry never stores or exposes old memory bodies to Memory V2 prompts, FTS, search, detail reads, governance screens, or fallback APIs.
- Make the V2 connection factory open only `memory-v2.sqlite` and reject the legacy database path, archive roots, `ATTACH`, and any repository adapter that can reach old memory stores.
- Integrate the index-only manifest/read protocol into Agent Chat, generic homepage chat, workflow chat, and collaboration participant context; workflow consumers must query the complete run's cross-Agent short-memory scope rather than a source-Agent bucket.
- Rework chat compaction and automatic context recovery to preserve frontend session/run scope and to use only V2 manifest recovery when a runtime session is invalid.
- Disable the legacy Agent-memory read/save/clear endpoint and remove its UI without converting its content into V2 long memory.
- Remove or return an explicit retired response from every old memory read/write route; instrument V2 connection and route access so cutover verification can prove zero legacy-content opens, queries, prompt reads, and fallback calls.
- Leave configuration-generation, recommendations, `workflow-start-contexts.json`, and existing Agent relationship behavior outside Memory V2 unless a later separately approved feature changes them. They must not become hidden V2 memory readers or writers.
- Keep `workflow-start-contexts.json` outside autonomous memory writes; document it as explicit user configuration.
- Complete the legacy-memory inventory after Task 3 removes manager-owned writes. Retire or explicitly exclude every remaining active `memory-store` reader/writer and ensure no consumer silently falls back while the V2 feature gate is disabled or not ready.
- No implementation follow-up remains in the Task 4 ownership boundary. Runtime zero-access telemetry, feature-flag behavior, archive isolation, and continuity verification remain explicit gaps.
- Add a fresh-start feature flag that activates V2 consumers only after the new database and archive registry are verified. Do not add dual write, shadow read, import jobs, outbox synchronization, legacy fallback, or migration parity gates.
- Normal disable/re-enable preserves `memory-v2.sqlite` and never creates a second fresh store over it. Resetting V2 data is deliberately outside this feature and requires a separate destructive-data decision.

## Acceptance

- Homepage chat and Agent Chat retrieve from the same scope hierarchy with their correct session identity; every authorized workflow Agent retrieves the same active short-memory source for its run.
- First V2 enablement starts with zero memory items, details, handoffs, and relationship records; no old memory is visible through V2.
- Removing the Agent management memory UI does not delete old data, but that data is not reachable through authorized V2 protocol-based reads.
- Runtime-session compaction does not make prior chat short memory unreachable.
- The archive registry proves legacy source hashes are unchanged and V2 reader/search/FTS/prompt/detail/endpoint paths made zero legacy-content accesses.
- Connection-factory and route-level tests reject the old database path and legacy endpoint calls; process-level access telemetry records zero legacy-content opens or queries while V2 consumers run.
- Disabling V2 preserves its new SQLite data for later re-enable and does not reactivate legacy memory reads as fallback.

## Verification Record

- 2026-07-24: Assigned after Task 1 Contract Gate A acceptance. Per user direction, no build or test command will be run; the Agent must return static consumer/legacy-path evidence and runtime gaps.
- 2026-07-25: Gate B static review accepted the Agent-memory route retirement and V2 consumer context direction, but left the task in progress pending coordinated removal of legacy writers outside the original chat/collaboration ownership boundary and actual Task 2 protocol wiring.
- 2026-07-25: Read-only consumer inventory found an unauthenticated `workflow/status` old-memory/full-body response (P0) plus old experience/memory prompt injection in Agent/config generation and recommendation routes. The inventory also confirms that `saveWorkflowFinalReview` is a permitted run audit artifact and relationship YAML remains outside V2. No build, lint, or test command was run.
- 2026-07-25: Task 4 static acceptance. The status route, core status type, and Workbench no longer expose old `memoryLayers`; only the permitted `finalReview` audit remains. Agent draft/config generation/recommendation code no longer reads old memory, experiences, or relationships, and the related history/relationship/auto-template UI controls are removed. Compatibility fields are empty rather than backed by a V2 or legacy fallback. No build, lint, or test command was run.
- 2026-07-25: Task 4C static acceptance. `prepareHomepageChatMemoryV2` supplies the same proposal/read protocol plan to homepage non-stream and stream engines; owner-bound persisted sessions are required before V2 scope resolution; and request-options no longer inject persisted transcript, raw output, or bound workflow/creation bodies. Static review found no browser-directory-to-V2-project authorization path. No build, lint, formatter, or test command was run.
