# Task 08 流程型 Skill 转工作流

Status: Pending

## Execution Contract

- Depends on: Tasks 02, 05
- Unlocks: Task 07
- Execution: Parallel / Wave 4
- Delegated owner: 待分配的实现 Agent
- Scope boundary: Skill 转换服务、草案入口与来源差异。由 Task 07 负责跨模块接线。

## Goal

流程型 Skill 转工作流。

## Current State

- 现有创建流程可保存轻量配置，目前没有 Skill 转换协议。

## Follow-Up Work

- 读取已安装 Skill 的正文与选定引用，结合可选声明生成顺序图和逐节点来源。输出诊断供画布编辑，确认后走统一保存及运行入口。
- 保存来源标识、内容摘要和协议版本，提供版本差异及重新生成草案。

## Acceptance

- 流程型 Skill 生成可校验草案，知识类 Skill 返回明确原因。缺参、无法表达的分支与待确认脚本在画布可定位。
- 草案生成不触发执行。来源变化、缺失和重新生成均保留既有工作流及手工编辑。

## Verification Record

- 本阶段完成设计，功能验证待实施。
