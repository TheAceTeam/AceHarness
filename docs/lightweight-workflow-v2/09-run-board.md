# Task 09 轻量运行与看板联动

Status: Pending

## Execution Contract

- Depends on: Tasks 03, 05
- Unlocks: Task 07
- Execution: Parallel / Wave 4
- Delegated owner: 待分配的实现 Agent
- Scope boundary: 运行证据投影、看板和画布联动组件。由 Task 07 负责工作台跨模块接线。

## Goal

轻量运行与看板联动。

## Current State

- 现有 LightweightTaskBoard 和任务证据适配器基于单步骤轻量流程。

## Follow-Up Work

- 用节点快照和增量事件扩展或重构投影。任务按 run、节点和尝试归属，连接日志、产物与子运行。
- 复用看板入口，支持画布和卡片双向定位，区分运行节点及其动态拆出的任务。

## Acceptance

- 手工及 Skill 转换的工作流都共享相同投影。脚本失败、子运行、重试及缺失证据正确显示。
- 断线、重复事件、切换和删除运行后无串数据，历史与实时视图结果一致。

## Verification Record

- 本阶段完成设计，功能验证待实施。
