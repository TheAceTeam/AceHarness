---
name: csi-dt-run
description: 用于生产实现完成后复跑 DT 基线集合和相关回归并形成 Green 验证证据时。
disable-model-invocation: true
metadata:
  pattern: dt-post-run
---

# 实现后 DT 执行

## 目标

使用真实命令复跑实现前稳定测试清单，证明目标 DT 达到 Green，并记录与目标模块直接相关的回归结果。

## 执行方法

1. 读取 `dt-test-code-summary.md` 与 `dt-baseline-report.md` 的稳定测试清单、命令和 Case 映射；
2. 确认 `implementation-summary.md` 的变更范围和快速检查结果；
3. 执行前计算基线测试文件内容 hash，核对 Case ID、测试名称和核心断言锚点；
4. hash 与基线一致时运行相同测试集合；新增回归单独记录来源，保持全部基线 Case；
5. 运行 DT 质量评审要求的相关回归；
6. 记录每条实际命令、退出码、发现/通过/失败/跳过数量和关键输出；
7. 按首个可操作根因对失败分类并给出 owner。

失败归属：

- 目标行为仍不满足或代码回归：`owner=implementation`；
- 测试契约、断言、fixture 或测试能力问题：`owner=dt`；
- 系统契约或设计围栏问题：`owner=design`；
- 验收判定问题：`owner=requirement`；
- 当前运行环境不可用：`owner=environment`，记录恢复条件和复现命令。

测试文件 hash、Case 映射或核心断言与基线不一致时设置 `owner=dt`，由 DT 设计阶段重新建立并评审基线；当前结果不形成 Green 证据。

## 产物契约

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: dt-post-run
status: blocked | ready
test_status: green | failed | blocked
baseline_version: <dt-baseline-report.md updated_at>
implementation_version: <implementation-summary.md updated_at>
updated_at: <ISO-8601>
---
```

正文包含执行环境、基线/本轮测试清单与 hash 对比、实际命令、退出码、结果统计、逐 Case 结果、单独列出的新增回归、失败根因与 owner、关键输出和结论。全部基线 DT 内容一致并通过、关键用例保持启用且相关回归满足正式要求时设置 `test_status: green`。
