# Task 15: Homepage Invalid-Model Send Failure Visibility

Status: In Review (99%; current focused revalidation passed, shared gate pending)

## Execution Contract

- Depends on: None. This is a post-archive corrective task and does not reopen Tasks 1-13.
- Unlocks: coordinator acceptance and the next full test gate for the current worktree.
- Execution: Wave 8, delegated implementation followed by coordinator verification.
- Delegated owner: homepage chat/runtime-route child.
- Scope boundary: own the homepage send contract in `src/contexts/ChatContext.tsx`, the start validation in `src/server/api-routes/chat/stream/route.ts`, and focused tests. Do not change model import, model-diagnostics UI, workflow runtime, or Task 14's ACPX result-recovery files.

## Goal

A user who selects a global model that is missing, inactive, incompatible with the selected engine, or otherwise lacks a usable runtime route must receive a clear visible failure. Sending a message must never clear the composer and appear to do nothing.

## Current State

- `ChatContext.sendMessage` records a visible failure when its resolved model or engine is empty, retaining the attempted input in the target session.
- Homepage stream start validates that the selected model has an active compatible runtime route, not merely a loaded engine selection.
- The stream route resolves the requested engine and validates its selected model before context construction or stream registration, so a rejected route returns an actionable error immediately.
- When a route exists but the underlying CLI rejects its model during asynchronous startup, the client receives one visible terminal failure instead of an empty or disconnected stream.

## Completed Work

- Defined one shared validation result for the selected engine/model before a new chat stream is registered.
- Converted missing or unusable selection into an explicit client-visible failure while preserving composer/session state for retry.
- Rejected invalid model routes before SSE registration with an actionable API error that identifies the selected engine and model without exposing secrets.
- Relayed asynchronous engine/model-start failure as one terminal visible stream error, so a route that exists but cannot actually run is not silently lost.
- Added focused regressions for missing selection, user-added model with no active compatible route, and an active valid route.

## Acceptance

- Homepage send never silently returns after user input has been cleared.
- A user-added model without an active compatible route produces an immediate visible error and does not leave an orphaned running stream or blank assistant card.
- A model that passes static route validation but is rejected by its CLI produces one visible terminal error rather than an empty/disconnected stream.
- A valid imported model route still starts streaming normally.
- The behavior is shared across runtime engines and is not a Codex-only special case.
- Focused client/route tests pass. The coordinator then runs TypeScript and the configured full test gate before marking this task done.

## Verification Record

- User reproduction recorded on 2026-07-31: an actually unavailable user-added global model makes homepage send appear to do nothing.
- 2026-07-31 Luna handoff added client-visible startup/SSE/recovery failure handling, early server route validation, and focused client/server regressions. The client-only focused assertions pass, but the combined API chat route suite exposes two valid-path regressions: an imported Codex route times out and ACPX tool events do not reach the SSE transcript as `<ace-process>`. These must be repaired before Task 15 acceptance.
- `2026-07-31 final coordinator acceptance`: the ordinary imported-Codex path now propagates pre-turn runtime failures instead of silently waiting for a nonexistent turn; structured tool events again reach `<ace-process>` delta and final output. The client records missing-selection, rejected-start, terminal engine failure, stream interruption, and recovery failure visibly without dropping the attempted user input. Combined focused verification passed `7 files / 81 tests`; final TypeScript, full Vitest (`163 files / 1077 passed / 6 skipped` with `--maxWorkers=1`), component (`30 files / 137 tests`), and E2E (`5/5`) gates passed.
- `2026-07-31 current focused revalidation`: `npx vitest run tests/chat-context.test.tsx tests/api-chat-runtime-model-route.test.ts tests/api-chat-route.test.ts tests/api-chat-stream-flow.test.ts` passed `4 files / 32 tests` against the current dirty worktree. This supersedes the former “revalidation pending” claim, but does not substitute for the shared TypeScript/browser/full-suite gate after Task 16.
- `2026-08-01 current corrective handoff`: `resolveActiveChatModelRoute` is shared by `/api/chat` and `/api/chat/stream`; both return an actionable `422` before chat context creation, session registration, or runtime turn start when the selected route is absent/inactive/incompatible. Existing client failure handling preserves a visible error and attempted input. `npx vitest run tests/chat-context.test.tsx tests/api-chat-runtime-model-route.test.ts tests/api-chat-route.test.ts tests/api-chat-stream-flow.test.ts` passed `4 files / 33 tests`; scoped `git diff --check` passed with line-ending warnings only. Shared gate remains required.
