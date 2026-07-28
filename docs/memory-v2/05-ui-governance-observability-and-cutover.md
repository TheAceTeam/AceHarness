# Task 5: UI, Governance, Observability, And Cutover

Progress: 100%
Status: Done (Static)

## Goal

Remove direct memory management from the Agent management page while providing only the global governance, audit, and rollout surfaces needed to operate Memory V2 safely.

## Current State

- The settings UI exposes `runtimeEnabled` and `persistMode`, but `persistMode` has no implemented write-policy effect.
- `AgentEditModal` exposes direct role-memory loading, text editing, saving, and clearing through the Agent-memory query/mutation hooks.
- Users cannot inspect a protocol decision's source, read condition, delivery mode, or retention state through a dedicated governance surface.
- No system-level review action currently approves, rejects, expires, or supersedes pending long-memory proposals with an auditable server-side transition.
- Workflow UI exposes outputs and status but not an explicit handoff index or unresolved issue ledger.
- Task 5A static review is complete: AgentEditModal has no memory budget/deep-search controls or direct memory text/save/clear controls, and the retired client query/cache/API methods have no remaining callers. The backend retired route remains a non-reading `410` response.
- Task 5B static review is complete: admin governance, audit, actions, versioned detail pages, diagnostics, and run-authorized handoff index/detail routes use server-derived contexts. Policy refreshes from persisted settings at enabled entry gates; short memory remains active while only pending long memory enters governance actions.
- Task 5C static review is complete: governance and workflow handoff panels consume only approved HTTP projections, list index/metadata before explicit versioned detail reads, retain the exact failed detail cursor for retry, and use server `nextOffset` pagination. Governance and handoff routes no longer strand records after offset 10,000, while page sizes remain bounded.

## Implementation Direction And Remaining Runtime Verification

- Remove the memory section from Agent management, including its load, editable text area, save, and clear controls. Do not replace it with another per-Agent memory CRUD surface.
- Replace ambiguous settings with separate capture enablement, long-memory governance mode, and bounded retention policy controls. Prompt reads are selected by the protocol rather than a single `runtimeEnabled` switch.
- Add a system-level audit/review surface showing proposal status, retention, scope, read condition, handoff mode/target, source, expiry, index/detail character counts, participant authorization result, and receipts. It must not allow direct detail editing.
- Add a review queue for pending long-memory proposals when governance mode is `review`, with only audited lifecycle actions: approve, reject, expire, supersede, or request reclassification. These actions cannot silently edit the detail body.
- Add a workflow handoff panel showing summaries addressed to the current step, required-read state, on-demand availability, source steps, and explicit detail reads.
- Add metrics and diagnostics for per-index and total manifest/search character counts, omitted-index count, required-read budget failures, detail pages/reads, failed receipts, rejected proposals, duplicate merges, scope-denied reads, resume reconstruction, fresh-store row counts, and legacy zero-access checks.
- Enable V2 through staged flags: create/verify empty `memory-v2.sqlite`, verify legacy archive hashes and zero access, enable capture, then enable each V2 consumer. Do not add import, dual write, shadow read, legacy fallback, or migration-parity flags.

## Execution Order

1. Task 5A may start only after Task 4 acceptance: remove Agent-page memory loading/editing/save/clear UI and its retired client hooks. It must not introduce a replacement per-Agent editor.
2. Task 5B may run in parallel with 5A after Task 4: add the server-owned governance/audit query and lifecycle-action contract, including authorization, immutable detail handling, audit records, and staged-cutover diagnostics. This is the only Task 5 unit allowed to extend stable V2 service/route contracts.
3. Task 5C is serial after 5B's API contract review: build the global governance/review UI, workflow handoff index/required-read UX, and diagnostics/cutover visibility against the approved API. It must not directly read SQLite or legacy files from the client.
4. Final static review is serial after 5A, 5B, and 5C. Runtime proof remains separately gated because this workstream does not run build or test commands.

## Ownership Boundaries

- 5A: `AgentEditModal`, retired Agent-memory query hooks/callers, and only related presentation types.
- 5B: Memory V2 governance/list/action contracts, authenticated routes, system setting semantics, and telemetry/cutover data producers.
- 5C: System-level governance UI, workflow handoff UI, diagnostics/cutover UI, and their approved client API adapters.
- Do not reintroduce legacy memory routes, YAML/old-SQLite reads, direct detail editing, dual write, or fallback behavior in any Task 5 unit.

## Acceptance

- The Agent management page contains no memory text, memory save action, or memory clear action after fresh-start flags permit removal.
- A system administrator can audit whether a record is short/long, why it is relevant, how it is delivered, and where it came from without editing its details.
- A reviewer can complete an auditable approve/reject/expire/supersede/reclassify transition for pending long memory without using an Agent management editor.
- Changing governance mode changes server write behavior and is covered by tests.
- The workflow UI can explain why a handoff appears, whether it is mandatory or on-demand, and show its source/detail without exposing unrelated records.
- Disabling V2 preserves new V2 SQLite data for later re-enable and does not restore legacy memory reads as fallback.
- Cutover dashboards show an empty initial V2 store, unchanged legacy archive hashes, zero legacy-content access, and no permission-denial regressions before V2 consumers are enabled.
- Diagnostics prove default prompts, search, and handoff payloads are index-only, stay within total-character budgets, and surface any blocked required-read state.

## Verification Record

- Not run: implementation must add UI interaction tests, API authorization tests, flag/cutover tests, observability assertions, and manual accessibility review.
- 2026-07-25: Task 5A static acceptance. `AgentEditModal`, retired Agent-memory query hooks/cache key, and client API methods no longer expose memory CRUD. Static caller scans found no remaining source references; no build, lint, formatter, or test command was run.
- 2026-07-25: Task 5B static acceptance. Governance list/audit projections remain index-only; detail reads are explicit, versioned, paged, and authorized. Workflow handoff routes bind persisted run ownership to V2 participant snapshots before exposing data. No build, lint, formatter, or test command was run.
- 2026-07-25: Task 5C final static acceptance. Governance UI accumulates server pages per filter set, resets only after a completed governance mutation, and can load additional replacement candidates. Handoff UI tracks the selected page offset and explicit detail cursor. Governance and handoff routes accept only validated query keys and single-value safe integers where applicable; `nextOffset` can traverse every server-reported record rather than stopping at 10,000. No build, lint, formatter, TypeScript, or test command was run.
