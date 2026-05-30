# 最小合法工作流示例

这是最简单的合法 ACEHarness 工作流配置。包含 1 个工作状态和 1 个终止状态。

## 结构说明

```
审查（isInitial） ──pass──> 完成（isFinal）
   │
   │──conditional_pass──> 完成
   │
   └──fail──> 审查（自身循环）
```

## 编排参考

- 审查状态：一个 reviewer 步骤完成审查，输出问题、风险、建议和验证证据。
- 完成状态：一个汇总步骤整理最终结果。
- 如果审查不通过，失败流转应回到审查状态继续补充。

## 关键要点

1. 初始状态用 `"isInitial": true`（不是 `"initial"`）
2. 终止状态用 `"isFinal": true`（不是 `"final"`）
3. 转移目标用 `"to"`（不是 `"target"`）
4. 非终止状态必须有 3 条转移：pass、conditional_pass、fail
5. 终止状态的 steps 和 transitions 都是空数组
6. projectRoot 必须是绝对路径（以 / 开头）
