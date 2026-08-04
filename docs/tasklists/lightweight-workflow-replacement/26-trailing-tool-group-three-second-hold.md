# Task 26: Trailing Tool-Group Three-Second Hold

Status: Done

## Execution Contract

- Depends on: Completed Task 23 reusable trailing-group behavior
- Unlocks: Current live-output timing acceptance
- Execution: Serial UI timing follow-up
- Delegated owner: Child agent
- Scope boundary: `src/components/chat/RuntimeToolEventList.tsx` and its focused component test only. Do not change Workbench keys, ACPX events, tool-event merge behavior, or transcript rendering.

## Goal

Keep the terminal tail of a streaming tool-call group open for three seconds before auto-collapse.

## Current State

- Task 23/25 prevent group remount flicker; the requested 3-second terminal hold is now implemented.
- The selected product behavior is a three-second hold.

## Follow-Up Work

- Change the reusable terminal stability duration to 3 seconds.
- Update the focused fake-timer test to prove the group remains open immediately before the threshold and the next tool resets the pending collapse.
- Retain immediate close when `isStreaming` becomes false.

## Acceptance

- A terminal streaming group remains open through 2.999 seconds of inactivity and closes after the 3-second threshold.
- A next tool arriving before the threshold keeps the group open.
- The group closes immediately when streaming ends.
- The focused component test passes.

## Verification Record

- Implementation: `RUNTIME_TOOL_GROUP_STABILITY_MS` is `3_000`.
- `npx vitest run tests/components/RuntimeToolEventList.test.tsx`: passed, `1 file / 7 tests`.
- Coordinator review: accepted. The test holds through `2_999ms`, verifies next-tool timer reset, verifies close at the next `1ms`, and retains immediate close when streaming ends.
