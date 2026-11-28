# Task 05: 构建共享 React Flow 画布编辑器

Status: Pending

## Execution Contract

- Depends on: Task 02
- Unlocks: Tasks 07, 08, 09
- Execution: Parallel wave 3
- Delegated owner: Future canvas-ui implementation agent; not assigned during this planning-only phase.
- Scope boundary: Shared canvas shell, node cards, edge rendering, connection stack, inspector integration, responsive layout and UI tests. Do not add a second graph dependency.

## Goal

用现有 `reactflow` 技术栈实现参考组件所体现的画布交互和视觉语言，并供轻量与状态机共用。

## Current State

- 仓库已有 `StateMachineGraphPanel`、`StateMachineDiagram`、`WorkflowCanvasInspector` 和 React Flow Provider。
- 粘贴的参考组件使用 `@xyflow/react`、点阵画布、节点卡片、右侧 Connection stack 和底部工具栏。
- 当前轻量编辑器不是画布。

## Follow-Up Work

- 抽出共享 `WorkflowCanvasShell`、节点卡片、边、工具栏和检查器插槽。
- 复用现有 React Flow 版本和事件模型，不安装或引入 `@xyflow/react`。
- 将参考组件的 `initialGraph`、`apps`、`onChange` 适配为 Canvas Document 和现有保存接口。
- 添加 Agent、Script、Subworkflow、Start、End 的节点模板和右侧添加动作。
- Subworkflow 节点选择目标工作流，显示 lightweight/state-machine 模式、版本策略、输入输出映射和失败策略。
- 使用现有 i18n、图标和设计 token；去除外部 logo URL、demo-only 状态和独立大段 CSS。
- 处理窄屏布局：右侧 stack 在画布下方或抽屉显示，检查器可折叠。

## Acceptance

- 轻量和状态机都使用同一套画布外壳，但通过能力开关显示各自复杂度。
- 节点选择、拖动、连接、添加、删除、编辑、撤销/重做和校验定位可用。
- Subworkflow 节点可以打开子工作流编辑页，但父画布不展开子图；模式徽标和版本/快照状态清晰可见。
- 画布不引入新的 React Flow 包或破坏现有状态机图。
- 参考组件的点阵、卡片、连接栈、底部控制和状态栏视觉意图得到保留，并符合现有主题/i18n。

## Verification Record

- 尚未运行；需在 Task 02 的 Canvas Document 适配层可用后执行。
