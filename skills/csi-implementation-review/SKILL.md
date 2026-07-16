---
name: csi-implementation-review
description: 用于统一裁决 AR、SDD、DT、代码变更和实现后 Green 证据是否形成完整实施闭环时。
disable-model-invocation: true
metadata:
  pattern: implementation-review
---

# 实施评审

## 目标

核验从 AR 到实现结果的端到端追踪和证据闭环，裁决工作流是否可以进入只读完成状态。代码审查负责逐文件 findings，本评审只核验 findings 处理和整体准入。

## 评审方法

1. 核对正式输入版本与状态；
2. 核对 AR/澄清 → design → plan/task → DT Case → 测试代码 → 基线 → 代码变更 → Green 的追踪；
3. 核对 task 完成矩阵、Changed Files、变更基线和代码审查的围栏矩阵；
4. 核对实现后执行覆盖基线稳定测试清单，必要增量具有来源；
5. 核对 `test_status: green`、关键 DT 启用和相关回归结果；
6. 核对基线测试文件 hash、Case 映射与核心断言一致；测试资产变更已经过 DT 重新基线和质量评审；
7. 核对每项变更为 `compliant` 或有效的 `authorized_exception`；例外需属于当前运行和精确范围，并保持行为、契约、任务完成条件与 DT 基线不变；
8. 核对 blocking/major code review findings 的处理状态，以及差异证据足以独立判断本次变更范围与归因；
9. 核对迁移、兼容、回滚和正式验收义务已经落实。

## 裁决语义

- `pass`：任务完成、目标 DT 与必要回归为 Green、变更为围栏合规或当前运行有效的一次性例外、差异证据充分、blocking/major findings 已解决、端到端追踪完整；
- `conditional_pass`：需求、SDD 和 DT 基线稳定，编码实现、差异/执行证据或实现类 finding 需要回到当前代码实现阶段修订或在可追踪基线上重新实施；
- `fail`：测试资产、系统设计或需求基线需要上游职责修订。

每个未关闭问题包含 ID、来源、证据、owner、修复条件和阻塞影响。`owner=implementation` 对应 `conditional_pass`；`owner=dt | design | requirement` 对应 `fail`。

一次性例外缺少有效授权、超出精确范围、跨越当前运行，或实际影响行为、契约、任务/验收、DT Case 或测试基线时，不具备准入效力；按问题来源分别回到 `implementation`、`design`、`requirement` 或 `dt`。

差异基线或补丁证据由实施阶段漏采集时使用 `owner=implementation`；运行环境阻止采集或验证时使用 `owner=environment`。两者都对应 `conditional_pass`：能够补齐时记录所需证据，已经无法从当前工作树重建时记录“从可追踪基线重新实施”的恢复条件。代码实现状态在有限重试预算内修订或重试，预算耗尽后 ACEHarness 将本次运行标记为失败。

评审能够完成准入判断时，`status` 使用 `reviewed`，并按裁决输出任一 verdict。正式输入缺失或不可读、导致评审本身无法完成时，`status` 使用 `blocked`；问题归属为 `implementation | environment` 时输出 `conditional_pass`，归属为 `dt | design | requirement` 时输出 `fail`。`status: blocked` 不得与 `verdict: pass` 组合。

## 产物契约

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: implementation-review
status: blocked | reviewed
verdict: pass | conditional_pass | fail
input_versions:
  clarification: <updated_at>
  design: <updated_at>
  plan: <updated_at>
  task: <updated_at>
  design_review: <updated_at>
  dt_cases: <updated_at>
  dt_test_code: <updated_at>
  dt_baseline: <updated_at>
  dt_quality: <updated_at>
  implementation: <updated_at>
  dt_post: <updated_at>
  code_review: <updated_at>
updated_at: <ISO-8601>
---
```

正文包含版本核验、端到端追踪、任务与围栏、一次性例外有效性、差异证据充分性、Green 证据、findings 处理、blocking issues、accepted risks、裁决理由和下一步类别。完成报告后在步骤结果中输出 ACEHarness 标准 verdict JSON。
