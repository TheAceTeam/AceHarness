---
name: csi-dt-design
description: 用于把已通过评审的完整 SDD 转换为可交给测试代码生成步骤的 DT Case 时。
disable-model-invocation: true
metadata:
  pattern: dt-design
---

# DT 测试设计

## 目标

以已通过评审的 SDD 为基线，定义能够验证其契约、任务验证义务和验证入口的最小充分测试设计。产物回答：在当前设计和实施任务中，从什么边界施加什么刺激，通过什么可观测结果判断实现是否正确。

## 输入处理

使用 Workflow 提供的正式输入。`design.md`、`plan.md`、`task.md` 和 `design-review.md` 共同定义本阶段的验证范围；`design-challenge.md` 仅用于读取 `design-review.md` 明确引用的 finding 或已接受风险。

代码仓用于核验设计声明的入口、test seam 和运行约束。从设计指向的位置开始读取，证据不足时沿相关调用、状态和依赖边界扩展。

修订轮次同时读取已有 `dt-cases.md` 和 `dt-quality-review.md`，逐项处理评审意见并保留已确认内容。实施回流存在时，读取 `implementation-review.md`、`dt-test-report-post.md` 和 `code-review.md`，沿用原 finding ID、owner 和证据；DT 问题在本阶段修订，design/requirement 问题交给质量评审继续向上游路由。

## 阶段一：建立验证义务

从需求设计产物中提取需要被证明的命题：

- 需求 → 设计 → 验证矩阵中的验证项；
- 接口、配置和数据契约；
- 状态转换、核心流程和错误行为；
- 兼容、迁移、回滚和保护区域；
- 相关权限、并发、异步、旁路和 DFx 约束；
- `design.md` 实施规划输入中的验证入口和 test seam；
- `task.md` 中每项任务的完成条件、验证义务和入口；
- `plan.md` 中迁移、发布、回滚和验证顺序；
- 设计评审明确接受并要求继承的风险。

每项验证义务引用设计产物中的稳定标识或明确章节。技术派生 DT 用于验证设计已经声明的契约、风险或验证入口，并保留来源映射。

## 阶段二：选择最小充分测试边界

为每项验证义务选择能够真实观察目标契约的最小边界：

- 纯逻辑和模块内规则采用单元或组件边界；
- 模块间交互采用组件、集成或契约边界；
- 持久化、事务、消息和迁移采用能够覆盖相关基础设施行为的边界；
- 跨模块用户链路在低层无法充分证明时采用端到端边界；
- 客观上不适合自动化的项定义可复现、可判定的替代验证。

测试层级由验证义务决定。一个 DT 可以覆盖多个来源，一个来源也可以拆为多个不同边界的 DT；数量服从验证价值和风险。

按实际问题选择等价类、边界值、决策表、状态迁移、场景路径、参数组合或故障路径等方法。

## 阶段三：设计有判定力的 DT

每个 DT 的核心信息包括：

- `case_id`；
- `source`：设计标识或章节；
- `objective`：需要证明的命题；
- `test_boundary`：测试层级、目标边界和选择理由；
- `stimulus`：操作、输入或触发条件；
- `oracle`：可观测结果、判定标准及来源；
- `disposition`：automated | manual | alternative | not_applicable | blocked。

按需补充 test seam、fixture、测试数据、test double、隔离与清理、时间或并发控制、环境依赖、目标位置策略和预实现预期信号。

Oracle 追踪到需求设计中的验收映射、契约、协议或稳定状态不变量，并独立于被测实现的计算路径。优先观察公开输出、持久状态、事件和外部契约；交互本身属于契约时，调用参数或次数可以成为断言。

依赖替代放在所有权边界或不可控外部边界，保留需要验证的核心路径。按验证义务说明成功、失败、超时或协议约束，以及替代后仍需保留的集成验证。

## 阶段四：安排验证处置

每项设计验证义务必须映射到一个或多个 DT，并记录处置：

- `automated`：关联可由下一阶段实现的 DT；
- `manual`：说明不宜自动化的理由、可复现步骤、判定证据和责任归属；
- `alternative`：说明替代证据及其能够证明目标的理由；
- `not_applicable`：记录适用性证据；
- `blocked`：记录阻塞事实和责任归属。

NFR 按其证据形态处理：明确阈值形成门禁验证；稳定不变量形成性质验证；探索目标形成 profiling 或观测建议；影响验收但尚未确定的标准形成上游 finding。

## 空仓和最低测试能力

当前仓库没有相关测试体系时，依据需求设计中明确的技术栈、目标结构和验证入口，定义最低测试能力契约：

- 需要支持的测试层级和运行入口能力；
- 被测边界以及必要的隔离、fixture 和报告能力；
- 环境与依赖约束；
- 下一阶段需要确定的实际落点。

需求设计尚未提供可验证入口或必要契约时，将对应验证义务标记为 `blocked` 并形成上游 finding。

## 证据不足时的处理

测试设计依据不足时，在 DT 产物中记录阻塞事实、证据、影响和责任归属。DT 内容自身可以补充的问题标记为 `owner=dt`；系统契约或验证入口不足标记为 `owner=design`；需求判定标准不足标记为 `owner=requirement`。DT Judge 根据正式产物统一裁决。

## 产物契约

Workflow 指定的 `dt-cases.md` 使用以下状态：

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: dt-design
status: draft | blocked | ready
input_versions:
  design: <design.md updated_at>
  plan: <plan.md updated_at>
  task: <task.md updated_at>
  design_review: <design-review.md updated_at>
updated_at: <ISO-8601>
---
```

正文按实际影响组织，至少包含：

- 测试目标和设计基线；
- 验证义务 → DT → disposition 矩阵；
- 测试边界与相关仓库证据；
- DT Case；
- 按需测试能力、fixture、依赖替代和环境约束；
- manual、alternative、not_applicable 和 blocked 项；
- 测试代码生成交接信息；
- 修订轮次的评审响应。

所有验证义务均有明确处置、没有 `blocked` 项，并且 DT 足以交给测试代码生成步骤时设置 `status: ready`。本步骤维护 DT Case，测试代码由下一步骤生成。
