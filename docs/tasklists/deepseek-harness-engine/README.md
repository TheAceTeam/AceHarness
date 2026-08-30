# DeepSeek Harness ACPX 引擎任务清单

Updated: 2026-08-30

本清单基于 ACEHarness 当前分支、`@openma/deepseek-harness-acp@0.4.26` npm 包、其锁定 DSH runtime 与本地 ACP 协议探针。目标是通过 ACPX 提供完整 DeepSeek Harness 引擎；依赖在用户安装阶段完成，运行期直接复用 DSH_HOME。

## Entrypoints

- [设计锁](00-design-locks.md)
- [依赖与执行计划](implementation-order.md)
- [当前验证缺口](verification-gaps.md)
- [最近验证](verification-log.md)
- [范围外事项](out-of-scope.md)
- [历史记录](archive.md)

## Execution Ownership

- 协调者（root agent）：安排任务、审查证据、更新进度和汇总结果。
- 子代理：只执行分配任务的代码、测试或文档变更，并返回改动、验证证据和阻塞项。

## Task Documents

- [Task 1：OpenMA ACP 依赖与 launcher](01-openma-acp-launcher.md)
- [Task 2：DSH_HOME 与环境变量适配](02-dsh-home-environment.md)
- [Task 3：ACPX 会话、模型与事件兼容](03-acpx-compatibility-tests.md)
- [Task 4：前端入口与安装验证](04-frontend-install-verification.md)

## Current Judgment

- OpenMA 包已提供完整 ACP surface 和锁定的 DSH runtime；standalone `dsh-acp` 可由 ACPX 直接启动。
- OpenMA 的 profile plugin 与 standalone 模式共享 DSH_HOME；ACEHarness 采用 standalone 模式，不再生成自有 profile。
- 前端公共引擎注册表、引擎管理、模型管理、选择器、Agent 配置、聊天/工作流/工作台、诊断以及个人/系统环境变量设置继续统一接入 `deepseek-harness`。

## Overview

| Progress | Task | Status | Depends On | Execution | Notes |
|----------|------|--------|------------|-----------|-------|
| 100% | Task 1：OpenMA ACP 依赖与 launcher | Done | None | Wave 1 | 已直接解析 `@openma/deepseek-harness-acp` 的 `dsh-acp`，并通过启动器与打包验证。 |
| 100% | Task 2：DSH_HOME 与环境变量适配 | Done | Task 1 | Wave 2 | 已复用 DSH Web 配置、凭据、模型路由和权限变量，不创建 ACEHarness profile。 |
| 100% | Task 3：ACPX 会话、模型与事件兼容 | Done | Tasks 1-2 | Wave 3 | 已验证 OpenMA 与 ACEHarness ACPX 的会话、模型、流式事件、恢复、取消和本地 provider fixture。 |
| 100% | Task 4：前端入口与安装验证 | Done | Tasks 1-3 | Final | 前端入口、环境变量、发布包、隔离安装和功能回归均已完成。 |
