---
name: csi-dt-quality-review
description: 用于独立裁决 DT Case、真实测试代码和实现前基线是否足以约束代码实现时。
disable-model-invocation: true
metadata:
  pattern: dt-quality-review
---

# DT 质量评审

## 目标

基于完整 SDD、DT Case、真实测试资产和本轮基线证据，裁决当前 DT 是否具备代码实现准入条件。实施回流存在时，继承 implementation-review、DT Post 和 code-review 的 finding ID、owner 与证据。

## 评审方法

1. 核对需求/设计锚点到 Case、测试文件、测试名称和断言的追踪；
2. 核对每项自动化 Case 是否被真实测试承接，其他 disposition 是否保持有效理由；
3. 核对测试边界、Oracle、fixture 和 test double 是否保持目标行为与契约；
4. 核对关键 DT 是否启用，测试发现、执行命令和输出是否来自本轮；
5. 逐项核验 `valid_red`、`valid_green`、`invalid_test`、环境阻塞和既有失败的证据；
6. 核对最低测试能力变更是否具有设计来源且不改变生产行为；
7. 确认实现后可复用的稳定测试清单与命令完整。
8. 核对所有直接输入版本一致，稳定测试清单包含文件 hash 与断言锚点。

## 裁决语义

- `pass`：DT 产物均为 `ready`，所有自动化 Case 具有可执行测试，基线只包含有证据的 `valid_red`/`valid_green` 与已隔离的既有失败，可以进入代码实现；
- `conditional_pass`：需求和 SDD 稳定，DT 用例、测试代码、基线证据或最低测试能力存在当前阶段可自动修订的问题；
- `fail`：需求判定、系统契约、test seam 或设计围栏需要上游实现设计修订。

每个问题包含 ID、来源、证据、影响、owner、修复条件和状态。`owner=dt` 对应 `conditional_pass`；`owner=design | requirement` 对应 `fail`。

实施回流中 `owner=dt` 的 finding 在 DT 资产修订后复核；`owner=design | requirement` 的 finding 保持 open 并以 `fail` 交给实现设计，由 SDD 评审继续区分设计修订或需求澄清。

## 产物契约

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: dt-quality-review
status: blocked | reviewed
verdict: pass | conditional_pass | fail
input_versions:
  design: <updated_at>
  plan: <updated_at>
  task: <updated_at>
  design_review: <updated_at>
  dt_cases: <updated_at>
  test_code: <updated_at>
  baseline: <updated_at>
  implementation_review: <updated_at，存在实施回流时>
  dt_post: <updated_at，存在实施回流时>
  code_review: <updated_at，存在实施回流时>
updated_at: <ISO-8601>
---
```

正文包含追踪结论、测试质量、基线有效性、范围核验、blocking issues、accepted risks、稳定测试清单摘要、裁决理由和下一步类别。评审只维护质量报告。
