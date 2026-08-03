# Task 23: Stable Trailing Tool-Call Groups

Status: Done

## Execution Contract

- Depends on: None
- Unlocks: None known
- Execution: Parallel wave 11 UI slice
- Delegated owner: Child agent
- Scope boundary: `src/components/chat/RuntimeToolEventList.tsx` and its focused component tests only. Do not alter transcript projection or Workbench event grouping.

## Goal

Keep a final contiguous group of tool calls visually stable while the assistant response is still streaming, instead of immediately auto-collapsing after each terminal tool event and reopening for the next call.

## Current State

- `RuntimeToolEventGroup` immediately runs `setOpen(false)` when `pendingCount` reaches zero.
- The next pending tool reopens the same group, yielding repeated collapse/expand flicker at the tail of a tool sequence.

## Follow-Up Work

- Add a short, resettable trailing-stream stability delay before auto-collapsing a terminal group.
- Keep manual user expansion/collapse behavior intact.
- Close normally after streaming ends or the stability window expires.

## Acceptance

- Consecutive tool calls during one live response do not repeatedly collapse and reopen their shared group.
- A terminal trailing tool group auto-collapses after a brief inactivity window rather than remaining permanently open.
- Completed response and failed-tool states remain correctly rendered.

## Verification Record

- `npx vitest run tests/components/RuntimeToolEventList.test.tsx`: passed, 7 tests.
- Coordinator review: accepted. The streaming-only 3 s resettable stability window is scoped to the reusable group component; non-streaming completion still closes immediately. Task 25 verifies that the Workbench caller preserves this component's identity across lifecycle updates.
