# Task 25: Workbench Tool-Group Identity Stability

Status: Done

## Execution Contract

- Depends on: Completed Task 23 reusable debounce; coordinate with Task 20 because both touch Workbench
- Unlocks: Current live-output interaction acceptance
- Execution: Serial Workbench owner lane
- Delegated owner: Child agent
- Scope boundary: the live-output timeline/key logic in `src/client/pages/workbench/WorkbenchClient.tsx` and one focused regression. Do not modify ACPX event transport, tool-event merging, or the reusable `RuntimeToolEventGroup` contract unless a review proves the caller cannot supply a stable identity.

## Goal

Keep a contiguous trailing group of live tool calls mounted while its members complete and the next tool call arrives, so the existing terminal stability delay prevents collapse/reopen flicker.

## Current State

- `RuntimeToolEventGroup` keeps a terminal streaming group open for a resettable 3-second window.
- The Workbench virtual-list key changes from `pending` to `done` and embeds the current last tool ID. Those ordinary lifecycle updates remount the group, reset local state, and make the group appear to close then reopen.

## Follow-Up Work

- Give a contiguous tool group a stable key derived from its first tool identity, independent of lifecycle status and later appended calls.
- Preserve a new group boundary after a non-tool timeline item; unrelated tool runs must not share UI state.
- Add a focused regression proving the mounted group identity is stable from running to completed and when a next contiguous tool is appended.

## Acceptance

- Completing the last current tool does not remount or instantly collapse the streaming group.
- A next contiguous tool arriving within the terminal stability window keeps the same group open.
- A text/feedback boundary creates an independent group and does not inherit the prior group state.
- The focused regression passes. Browser confirmation remains part of the shared Workbench gate.

## Verification Record

- Static triage: confirmed the former virtual-list keys included `pending`/`done` and the current last tool ID, causing an unnecessary remount.
- Implementation: the Workbench now derives each contiguous group key from its first tool identity only; lifecycle state and later appended tools do not alter it.
- `npx vitest run tests/components/RuntimeToolEventList.test.tsx`: passed, `1 file / 7 tests`.
- `git diff --check -- src/client/pages/workbench/WorkbenchClient.tsx src/client/pages/workbench/live-tool-group-identity.ts src/components/chat/RuntimeToolEventList.tsx tests/components/RuntimeToolEventList.test.tsx`: passed (line-ending warnings only).
- Coordinator review: accepted. No broad test suite or browser run was needed for this focused interaction repair.
