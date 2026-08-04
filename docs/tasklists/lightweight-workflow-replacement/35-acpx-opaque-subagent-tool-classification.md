# Task 35: ACPX Opaque Subagent Tool Classification

Status: In Progress (10%)

## Execution Contract

- Depends on: Task 14 ACPX tool-event recovery and Task 27 lightweight task-board evidence.
- Unlocks: accurate live tool labels and evidence-backed child-Agent activity for ACPX-routed engines.
- Execution: serial adapter normalization, then focused projection/task-board acceptance.
- Delegated owner: ACPX adapter implementation agent.
- Scope boundary: shared ACPX event normalization and focused regressions only. Do not add a Codex-only UI fallback, alter unrelated tool grouping, or manufacture child-Agent evidence.

## User-Reproduced Defect

Provider-private ACPX orchestration calls such as `spawnAgent` and `wait` arrive in the live event stream as opaque `other` events. The UI therefore renders `other` for both running and terminal cards, and the lightweight task board cannot derive any child-Agent activity, even though the persisted ACPX ToolUse records contain the real call name and input.

## Goal

Normalize opaque ACPX ToolUse events into the shared runtime tool contract before projection:

- `spawnAgent` maps to `subagent-dispatch`.
- `wait` maps to `subagent-wait`.
- A running event and its terminal update retain one canonical name and identity.
- Persisted ToolUse input is retained so the lightweight task board can derive actual child-Agent name, task, model, count, and status.

## Acceptance

- An ACPX `other` event matched to persisted `spawnAgent` renders as `启动子 Agent`, never `other`.
- An ACPX `other` event matched to persisted `wait` renders as `等待子 Agent`, never `other`.
- Terminal-only opaque updates retain the name/input established by the running event.
- Matching tolerates ACPX's real event ID variants without associating a call from another session or turn.
- Lightweight task-board evidence produces child-Agent activity from the normalized dispatch/wait events.
- The repair applies to all ACPX-routed engines and does not rely on a Codex-specific display branch.
- Focused regression tests cover dispatch, wait, running-to-terminal continuity, and task-board evidence.

## Current Evidence

- User live reproduction on 2026-08-01 still shows `other Completed` and `other Running`.
- Existing persisted ToolUse enrichment only copies `name` and `rawInput` onto one event shape; downstream fields or event-ID matching can still preserve `other`.
- Existing runtime projection already understands `spawnAgent -> subagent-dispatch` and `wait -> subagent-wait`; the missing behavior is upstream ACPX normalization continuity.

## Verification Record

- Pending focused adapter and task-board regression run from the delegated implementation.
