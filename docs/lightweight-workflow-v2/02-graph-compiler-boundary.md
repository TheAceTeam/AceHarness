# Task 02: 建立旧配置适配器与画布编译边界

Status: Pending

## Execution Contract

- Depends on: Task 01
- Unlocks: Tasks 03, 04, 05, 08
- Execution: Parallel / Wave 2
- Delegated owner: Future workflow-compiler implementation agent; not assigned during this planning-only phase.
- Scope boundary: Canvas↔legacy config adapters, compiler result, node/step mapping, snapshot shape, and diagnostics. Do not add new marketplace behavior or redesign the editor.

## Goal

在画布编辑模型和现有 workflow YAML/runtime 之间建立稳定的编译和适配层，保持旧工作流可运行。

## Current State

- 运行时直接读取现有 workflow config。
- 轻量和状态机都有各自的 schema 约束。
- 运行记录需要避免后续编辑复活或改变已删除/已启动 run 的状态。

## Follow-Up Work

- 实现旧 lightweight → Start/Agent/End 图的适配。
- 实现旧 state-machine → state group/step node/transition edge 图的适配。
- 实现 Canvas IR → 轻量顺序执行计划和 state-machine 配置快照。
- 将 Subworkflow 节点编译为现有子工作流步骤，固定子配置快照并输出父子 run 映射。
- 为每个画布节点保存稳定的 state/step 执行引用。
- 编译时生成不可变 run snapshot，并返回节点级诊断。
- 设计编译失败的字段路径、节点 ID、边 ID 和用户提示格式。

## Acceptance

- 现有工作流没有 `canvas` 字段时，打开、保存和运行行为保持不变。
- 编译结果可以追溯到节点/边，并且 run snapshot 不随后续编辑变化。
- 旧状态机的审核、转移、并发和脚本字段不会在适配过程中丢失。
- 子工作流的模式、版本、输入输出和失败策略不会在编译过程中丢失，也不会产生递归依赖快照。
- 非法图不会生成可运行快照，错误能定位到具体节点或边。

## Verification Record

- 尚未运行；依赖 Task 01 的契约冻结。
