# Task 17: Default Tasklist Location And Viewer

Status: Done

## Execution Contract

- Depends on: Task 4, Task 5, Task 7
- Unlocks: None
- Execution: Serial integration
- Delegated owner: Coordinator implementation and review
- Scope boundary: creation/design/run surfaces, source-aware run-document API, DocumentsPanel, Workbench navigation, and focused regression tests. The persisted tasklist directory contract and Agent runtime prompt remain owned by the existing lightweight runtime.

## Goal

Keep the tasklist directory as an automatically derived runtime detail and provide a first-class Workbench view for tasklist documents.

## Completed

- Removed the tasklist directory field from lightweight creation and design surfaces.
- Removed the raw tasklist path from the lightweight run overview while keeping the tasklist document entry.
- Added source filtering to the run-document service and API.
- Added `步骤文档` and `任务清单` source tabs to the document viewer, with the lightweight run navigation and overview entry opening the tasklist source directly.
- Preserved the existing persisted directory derivation and Agent instruction that identifies where task documents are created and read.

## Acceptance

- Creation and design UI contain no tasklist-directory input or path display.
- `GET /api/runs/:id/documents?source=tasklist` returns only tasklist documents.
- Lightweight Workbench runs expose a `任务清单` entry and the viewer can preview tasklist files through the existing safe document-content API.
- The `全部` source view continues to show both tasklist and runtime documents.

## Verification Record

- `npx vitest run tests/components/NewConfigModal.test.tsx tests/components/LightweightWorkflowDesignPanel.test.tsx tests/task8-config-documents.test.ts`: pass, 3 files / 12 tests.
- `Invoke-WebRequest http://127.0.0.1:5173/src/client/pages/workbench/WorkbenchClient.tsx`: pass, HTTP 200 from the active Vite server.
- `npx tsc --noEmit`: the 120-second tool limit was reached without diagnostics; no TypeScript result is claimed from this command.
