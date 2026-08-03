# Task 20: Lightweight Runtime Navigation Simplification

Status: Done

## Execution Contract

- Depends on: Reviewed Task 18 and Task 19 implementation
- Unlocks: None known
- Execution: Serial Workbench slice after Task 18
- Delegated owner: Child agent
- Scope boundary: lightweight branches in `src/client/pages/workbench/WorkbenchClient.tsx` and document-view configuration only. Do not alter state-machine navigation.

## Goal

Present lightweight runs as tasklist-driven execution, rather than as a one-node state machine.

## Completed

- `WorkbenchClient.tsx` now excludes `状态图` and generic `步骤文档` navigation for `profile: lightweight`, retains `任务清单`, and redirects stale lightweight state/document URLs to the tasklist view.
- `DocumentsPanel` receives a locked `tasklist` source for lightweight runs. `DocumentSourceTabs` intentionally renders nothing when a source is locked, so unusable `全部 / 步骤文档` controls are not exposed.
- State-machine navigation continues to pass no lock and retains its state graph and source tabs.

## Acceptance

- A lightweight run has no visible state-graph or generic step-document navigation item.
- The tasklist document viewer remains reachable and does not mix runtime-output documents into the lightweight tasklist view.
- A lightweight tasklist view does not render a selectable `步骤文档` or `全部` source tab.
- State-machine runs keep state graph and step-document navigation unchanged.

## Verification Record

- 2026-08-01: `npx vitest run tests/components/DocumentsPanel.source-tabs.test.tsx` passed `1/1`. It proves a locked lightweight tasklist source renders no tabs, while an ordinary state-machine source retains `全部 / 步骤文档 / 任务清单` tabs.
- 2026-08-01: Coordinator reviewed the lightweight branches in `WorkbenchClient.tsx`, `DocumentsPanel.tsx`, and `DocumentSourceTabs.tsx`; the run/preview navigation and document-source lock match the acceptance contract. `git diff --check` reported only existing line-ending warnings.
