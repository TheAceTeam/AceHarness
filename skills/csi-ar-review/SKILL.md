---
name: csi-ar-review
description: 用于独立审查 AR 澄清产物能否支撑后续设计、验收和测试时。
disable-model-invocation: true
metadata:
  pattern: ar-clarification-review
---

# AR 澄清评审

## 输入

必须显式读取：

- 原始 AR；
- `specs/<AR-ID>/design/clarification.md`；
- `projectRoot` 中与当前 AR 相关的必要证据。

若已有设计失败回流记录，也读取 `specs/<AR-ID>/design/design-review.md`，但不得把设计建议直接当成 AR 事实。

## 输出

写入：`specs/<AR-ID>/design/clarification-review.md`

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: ar-clarification-review
status: blocked | reviewed
verdict: pass | conditional_pass | fail
ar_version: <clarification.md ar_version>
clarification_version: <clarification.md updated_at>
updated_at: <ISO-8601>
---
```

正文必须包含：

- 输入产物路径和更新时间；
- AR 目标/范围/不做项检查；
- 场景、FR/NFR/业务规则和 AC 覆盖检查；
- blocking issues；
- non-blocking issues；
- 是否可以进入设计的结论。

评审先核对原始 AR 指纹与 clarification 直接输入版本。缺少 AR、`clarification.md`、版本链或必要字段时，写 `status: blocked`，并裁决为 `fail`。

## 通过条件

只有以下条件全部满足时才能 `pass` 或 `conditional_pass`：

- `clarification.md` 的 `status: ready`；
- 没有影响设计、验收或测试的未决问题；
- AR 的目标和边界未被 Agent 改写；
- 关键主流程、相关备选/异常路径和验收条件已覆盖；
- 业务规则包含明确触发条件和可判定标准，并保持技术实现无关；
- 验收准则覆盖相关场景和业务规则，且每项准则都有对应测试用例；
- 测试用例包含前置条件、可执行步骤和可验证结果，必要的负面测试已覆盖；
- 非阻塞假设已标注影响；
- 任何设计回流问题都已确认是否真的改变 AR。

## 裁决语义

- `pass`：澄清产物完整、一致且可以进入需求设计；
- `conditional_pass`：仅剩已明确记录、不会影响设计与验证的非阻塞事项；
- `fail`：仍有需求事实、场景、业务规则或验收准则需要用户确认。

## 职责与产物边界

- 评审对象是已有 AR 及其澄清产物；
- 架构和实现决策由需求设计阶段负责；
- 正式文件是裁决依据；
- 本阶段输出 `clarification-review.md` 并给出独立裁决。
