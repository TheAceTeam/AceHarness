# Task 6: Runtime Session And Agora Backend Removal

Status: Done

## Execution Contract

- Depends on: Tasks 1, 2, and 3.
- Unlocks: Task 7.
- Execution: Parallel wave 2.
- Delegated owner: Child Agent C or a new child after Task 3 review.
- Scope boundary: Own workflow start/session binding/backend Agora paths, workflow-topic helpers, state-manager chat-event adapters, and runtime API behavior. Do not edit create/design UI, documents API/UI, `WorkbenchClient.tsx`, `StateMachineExecutionView.tsx`, or sidebar plugin registration removed by Task 2.

## Goal

Bind lightweight runs to ordinary conversations and remove backend Agora workflow-room creation while retaining runtime events and human interaction.

## Completed

- Workflow starts create or bind an ordinary conversation and persist a workflow binding without creating a collaboration-room chatroom.
- Lifecycle and channel feedback records use the persisted workflow event store plus runtime SSE transcript events; the workflow-only Agora topic helper is removed.
- Existing human questions, approval, feedback, resume, child-run and run-state paths remain on their state-machine contracts.
- Lightweight run metadata and its tasklist directory are server-owned for formal runs, restore, and rehearsal. A shared reservation rejects active same-directory use with `409` before rehearsal creates a session or directory.

## Acceptance

- Starting a lightweight workflow creates/binds a regular conversation without `collaborationRoom.chatroom` workflow-room setup.
- State-machine and lightweight lifecycle events remain available to the runtime UI without Agora messages.
- Human questions and child-run status retain access control and resume behavior.
- This task does not touch runtime UI files owned by Task 7.

## Verification Record