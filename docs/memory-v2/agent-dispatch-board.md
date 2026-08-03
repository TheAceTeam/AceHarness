# Memory V2 Agent Dispatch Board

Updated: 2026-07-25

## Operating Model

- The main Agent owns scheduling, dependency decisions, code review, conflict resolution, and task-status documentation. It must not implement runtime code.
- A child Agent owns only the task assigned on this board. It may inspect related code and update runtime code within its task boundary, but it must not alter another active track's owned files.
- All Agents preserve existing unrelated worktree changes and use focused edits only. They do not reset, restore, or bulk-reformat files.
- Per user direction, no Agent runs build or test commands. Each Agent instead returns the changed-file list, public-contract changes, static inspection performed, and every unproven behavior.
- An Agent must stop for a contract conflict, ambiguous legacy path, or overlapping-file need. The main Agent will resolve it before work resumes.

## Dependency Graph

```text
Task 1: schema + Memory Service
             |
             v
        Contract review gate
        /         |         \
       v          v          v
 Task 2        Task 3      Task 4
 AI protocol   workflow    chat/legacy cutover
        \         |         /
         \        v        /
          Phase B integration review
                    |
                    v
          Gate B repair wave (bounded)
                    |
                    v
          Task 5: UI/governance/cutover
                    |
                    v
              final static review
```

## Dispatch Waves

| Wave | Task | Dependency | Agent ownership | Must produce before review |
|---|---|---|---|---|
| A | Task 1 | None | V2 persistence, migrations, service contracts, scope/authorization snapshots, handoff primitives, archive registry primitives | Exported API/type inventory, migration inventory, changed-file list, static evidence, open assumptions |
| Gate A | Contract review | Task 1 diff complete | Main Agent | Approved immutable downstream interface list or a narrowly scoped repair request |
| B1 | Task 2 | Gate A approved | AI memory tools, decision parser, prompt manifest adapter, explicit detail reads | Protocol mapping, changed-file list, contract use report, static evidence, open assumptions |
| B2 | Task 3 | Gate A approved | Lightweight tasklist/state-machine handoff adapters, run/channel persistence integration, resume path, required-read state | Workflow-path mapping, changed-file list, contract use report, static evidence, open assumptions |
| B3 | Task 4 | Gate A approved | Chat/collaboration consumers, legacy route retirement, feature-flag and archive wiring, session continuity | Consumer/legacy-path inventory, changed-file list, contract use report, static evidence, open assumptions |
| Gate B | Integration review | B1, B2, B3 complete | Main Agent | Compatibility findings, ownership-conflict decision, required repair tasks |
| B-R1 | Task 1 repair | Gate B finding: session-short ordinary manifest omission | V2 `memory-service` only | Static proof that a matching session-short `handoff: none` item appears only in its own session manifest |
| B-R2 | Task 2 repair | Gate B finding: protocol has no execution call site | Engine protocol/adapters only | Native/fallback invocation path, stripped visible output, required-read gate, changed-file list |
| B-R3 | Task 3 repair | Gate B finding: workflow bypasses fresh-start and retains legacy writer | Workflow handoff/managers only | Feature-gated V2 initialization, retired legacy final-memory write, protocol integration boundary report |
| B-R3b | Task 3 follow-up repair | B-R3 review: workflow trusts model-authored handoff IDs and bypasses Task 2 execution protocol | Workflow handoff/managers only, consuming Task 2's public protocol APIs | Per-step server-issued source event, actual protocol execution, stripped fallback control blocks, and handoff IDs proven to be persisted active proposals from that event |
| B-R4 | Task 1 repair | B-R3b review: service cannot atomically emit and resolve targets, or reissue required-read targets on retry | V2 `memory-service` and public types only | Transactional `emitResolvedHandoffBatch`, immutable selector/revision validation, and idempotent retry-target reissue API |
| Gate B-R | Repair review | B-R1, B-R2, B-R3, B-R3b, B-R4 complete | Main Agent | No unresolved direct legacy writer, V2 protocol reachable from Agent Chat and workflow execution, atomic handoff/receipt state, and consumer contract reconciliation |
| C | Task 5 | Gate B approved | Agent-management UI removal, global governance/audit UI, workflow handoff UI, diagnostics, staged cutover | UI/route inventory, changed-file list, static evidence, open assumptions |
| Final | Final review | Task 5 complete | Main Agent | Updated status board, static review summary, remaining verification gaps |

## Gate B-R Decision

- 2026-07-25: Pass for static integration review. Task 1's atomic handoff/retry contract, Task 2's execution protocol, and Task 3's workflow integration use one compatible public surface.
- Remaining Task 4 cleanup is split by non-overlapping ownership: status-route/API/Workbench removal and Agent/config generation/recommendation removal may proceed in parallel. Task 5 remains serial after both cleanup units receive static acceptance.
- Runtime behavior is not claimed as verified. SQLite rollback/concurrency, real provider fallback execution, resume/retry/channel authorization, and UI behavior remain in `verification-gaps.md`.

## Active Dispatch

| Unit | Status | Owned Files | Completion Evidence |
|---|---|---|---|
| Task 4A: Status/Workbench legacy-reader removal | Done (Static) | `workflow/status` route, WorkflowStatus API contract, Workbench memory-layer display | No `memoryLayers`, old memory/experience imports, or unauthenticated V2 replacement remain; `finalReview` audit remains intentionally scoped. |
| Task 4B: Draft/config/recommendation legacy-recall removal | Done (Static) | Agent draft generator, config generation/recommendation routes, related recommendation UI | No old memory/experience/relationship prompt injection or display remains; compatible fields are empty rather than falling back to old content. |

Task 4A and Task 4B are accepted for static review. Task 5 may now begin in the documented 5A/5B/5C dependency order.

| Unit | Status | Owned Files | Completion Evidence |
|---|---|---|---|
| Task 4C: Homepage capture and project-scope repair | Done (Static) | Homepage non-stream/stream Memory V2 adapter, persisted frontend-session identity, homepage/collaboration authorization inputs | Homepage execution uses the V2 protocol adapter; first-turn frontend session identity is owner-bound on the server; browser `workingDirectory` is not a V2 project grant or prompt-history source. |
| Task 5A: Retire Agent-page memory CRUD | Done (Static) | Agent edit modal, retired client query/cache/API call surface | No direct Agent-memory UI or caller remains; the backend retirement response is preserved. |
| Task 5B: Governance/settings/diagnostic contract | Done (Static) | Memory V2 governance service/routes, policy resolver, system settings, cutover diagnostics, run handoff routes | Server-owned policy refreshes from persisted settings; reviewer and run-owner authorization are fail-closed; short memory bypasses long-memory governance. |
| Task 5C: Governance/handoff/diagnostics UI | Done (Static) | Global governance UI, workflow handoff UI, approved client adapters, pagination route validation | No client SQLite/legacy access; list projections remain index-only; versioned detail reads are explicit and retryable; server `nextOffset` reaches records beyond 10,000. |

## Final Static Decision

- 2026-07-25: Tasks 1 through 5 are complete for static acceptance. The final review reconciled the shared workflow protocol manifest budget, homepage capture/session authorization, governance/handoff pagination, and strict governance-query parsing.
- This is not runtime acceptance. No build, lint, formatter, TypeScript, or test command was run by user direction; real provider, SQLite, authorization, resume, and UI behavior remains listed in `verification-gaps.md`.

## File Ownership Boundaries

| Task | May own | Must not change while parallel work is active |
|---|---|---|
| Task 1 | New V2 schema/service/types/database initialization and persistence adapters | Workflow managers, chat page components, governance UI, legacy consumer routing except the minimal V2 connection boundary |
| Task 2 | AI engine adapters, memory tool contracts/parsers, prompt assembly, detail-read adapter | Schema implementation, workflow managers, chat UI/routes, governance UI |
| Task 3 | Lightweight tasklist/state-machine workflow managers, channel/run handoff adapters, workflow context assembly | Chat consumers, legacy retirement routes, governance UI, Task 1 schema internals |
| Task 4 | Homepage/Agent/chat/collaboration consumers, legacy memory endpoints, feature flags, archive access guards, chat session continuity | Workflow managers, AI protocol parser/prompt adapter, Task 1 schema internals, governance UI |
| Task 5 | Agent-management UI removal, system audit/review UI, workflow handoff UI, metrics/diagnostics/cutover UI | Task 1 schema internals and stable Task 2/3/4 adapters unless a reviewed integration repair specifically requires it |

If an owned file is not obvious from these categories, the Agent must report the candidate file before editing it. Task 2 exclusively owns any shared AI memory resolver/prompt adapter; Task 4 consumes its exported V2 interface instead of editing that adapter. Task 3 exclusively owns workflow execution managers.

## Contract Gate A Checklist

The main Agent accepts Task 1 for downstream work only when its report shows all of the following:

- A stable exported request/result shape for `propose`, `upsert`, `resolve`, `expire`, `buildManifest`, `readDetails`, `search`, `acknowledgeRequiredRead`, and persisted handoff operations.
- Explicit enums/types for retention, lifecycle anchor, scope binding, read condition, delivery mode/target, visibility, receipt state, and detail revision.
- A single V2 connection path to `memory-v2.sqlite`, with no old database attach/import/fallback path.
- Index-only manifest/search result types that cannot contain raw details, plus explicit bounded detail-read result types.
- Server-derived participant/channel authorization and immutable short-memory anchors represented in the API.
- A clear list of any deliberate implementation deferrals. A downstream Agent must not paper over a missing API with a private duplicate store or raw-output fallback.

## Main-Agent Review Checklist

- Re-read every changed line and compare it against the design locks and protocol.
- Reject any direct legacy-content read, migration/import, dual-write, shadow-read, fallback, raw-output memory injection, or direct Agent-memory editor.
- Verify that parallel changes call the same Task 1 public contract rather than creating incompatible local memory records.
- Check that short memory is anchored to exactly one session or one run plus workflow and is not narrowed to a source Agent.
- Check that manifests/search/handoffs expose only bounded index fields; details require an explicit authorized versioned read.
- Record the review result and unresolved runtime proof in the task documents and verification tracking files.

## Status Update Rules

- `Ready To Dispatch`: the task definition and input documents are complete but no Agent has started implementation.
- `In Progress`: an assigned Agent has begun implementation within its ownership boundary.
- `In Review`: the Agent has returned a handoff report and the main Agent is examining the diff.
- `Blocked`: a named dependency or interface decision prevents safe work.
- `Done`: main-Agent review accepts the implementation and documents residual verification gaps.

The status board is updated by the main Agent after each dispatch, handoff, and review decision. It must not claim runtime verification that was not performed.
