# Recent Verification

Updated: 2026-07-07

## 2026-07-07 Workspace File View Preview Download Path Fix

- Scope: Audited and fixed the workspace file view, static HTML preview, download, and embedded Notebook file-selection paths.
- Evidence: `src/routes/api.workspace.static.$workspaceToken.$.ts` now adapts TanStack static splat requests into the server route by parsing the real request pathname with one decode pass and falling back to router params.
- Evidence: `src/server/api-routes/workspace/static/[workspaceToken]/[...filePath]/route.ts` now keeps `/` links stable, preserves query/hash for root-absolute assets, and only encodes pathname segments.
- Evidence: `src/lib/core/api.ts` now rejects empty static preview file paths before generating `/api/workspace/static/{token}/`.
- Evidence: `src/components/workspace/EditorPanel.tsx` now guards static preview URL generation so invalid paths do not trigger an iframe request.
- Evidence: `src/components/chat/FilePreviewDialog.tsx` now uses `workspaceApi.download()` for downloads, preserving filename and directory-download behavior from the workspace download route.
- Evidence: `src/client/pages/workbench/WorkbenchClient.tsx` now derives relative workspace file paths with Windows drive and UNC case-insensitive comparison.
- Evidence: `src/components/dashboard/DashboardPageShell.tsx` now includes `autoStart` in Workbench outer query migration.
- Evidence: `src/components/dashboard/DashboardDockWorkspace.tsx` and `src/client/pages/NotebookPage.tsx` now keep embedded Notebook file selection inside the Dockview tab search state.
- Verification: `npx tsc --noEmit --pretty false` passed.
- Verification: Direct static requests for `package.json` and `configs/notebook/global/Notebook 编辑器功能介绍.cj.md` returned 200 and did not include `缺少文件路径`.
- Verification: Direct `/api/workspace/file?workspace=...&file=package.json` returned 200.
- Verification: Direct `/api/workspace/download?workspace=...&path=package.json` returned 200 with `Content-Disposition`.
- Verification: Playwright opened the reported `rider.html` Workbench deep link on `http://localhost:5173` and captured no `缺少文件路径`, `pageerror`, `notFound`, `Maximum update depth`, invalid element, or lazy component errors.
- Result: Pass.

## 2026-07-07 Dashboard And Workbench Navigation Active State Fix

- Scope: Fixed active-state ownership across the outer dashboard sidebar, Workbench run-detail navigation, and Workbench design navigation.
- Evidence: `src/components/dashboard/DashboardPageShell.tsx` now derives outer sidebar active state by route owner. Workbench tabs map to `工作流管理`; Knowledge, Knowledge Library, and Notebook map to `知识管理`.
- Evidence: `src/components/dashboard/DashboardDockWorkspace.tsx` now treats one workflow config as one Dockview Workbench tab. Changing `mode`, `runId`, `designTab`, or `workspaceFile` updates the existing tab rather than opening another Workbench tab.
- Evidence: `src/client/pages/workbench/WorkbenchClient.tsx` now derives the left Workbench navigation from URL state. A deep link with `runId`, `history=1`, and `tab=workspace` opens the `运行记录` branch, drills into the requested run, and highlights `Workspace`.
- Evidence: `src/client/pages/workbench/WorkbenchClient.tsx` no longer renders a duplicate horizontal design-tab toolbar; design navigation is owned by the left rail.
- Evidence: `src/components/StateMachineDesignPanel.tsx` no longer renders the `整体流程图` panel in the design page.
- Verification: `npx tsc --noEmit --pretty false` passed.
- Verification: Static scan found no `整体流程图`, `design-editor-diagram`, duplicate design-tab button variant, `辅助面板`, or `designTopToolbar` references in the checked Workbench design files.
- Verification: Playwright opened the reported Workbench URL and confirmed one Dockview tab before and after clicking `设计` and `执行配置`; `工作流管理`, `运行记录`, and `Workspace` were active; no relevant browser errors were captured.
- Verification: Playwright opened `/knowledge`, `/knowledge/library`, and `/notebook?notebook=1&notebookScope=global` through the dashboard route shell and confirmed `知识管理` active state.
- Result: Pass.

## 2026-07-07 Workbench Preview Hierarchy And Run Detail Recovery

- Scope: Corrected Workbench preview/run hierarchy after review.
- Evidence: `src/client/pages/workbench/WorkbenchClient.tsx` keeps `预览` as a single first-level entry and removes its child menu.
- Evidence: `运行记录` drilled detail keeps child entries for `总览`, `状态图`, `工作区`, `变更`, `对话`, and conditional `Spec`.
- Evidence: The preview panel uses empty placeholder metrics instead of reading live run values.
- Evidence: Run header actions now expose stop, context workbench, and process panel actions outside the overflow menu.
- Evidence: The legacy conversation panel uses vertical resizable panels for conversation and live output, with layout persisted by `react-resizable-panels`.
- Verification: `npx tsc --noEmit --pretty false` passed.
- Result: Pass.
