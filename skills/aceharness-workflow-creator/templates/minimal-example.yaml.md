# 最小合法工作流示例

这是最简单的合法 ACEHarness 工作流配置。包含 1 个工作状态和 1 个终止状态。

## 结构说明

```
审查（isInitial） ──pass──> 完成（isFinal）
   │
   │──conditional_pass──> 审查（继续迭代）
   │
   └──fail──> 审查（自身循环）
```

## 编排参考

- 审查状态：这是极简示例，可只保留 judge 出口；常规工作流仍应拆成 defender 产出、attacker 挑战、judge 裁决三步。
- 完成状态：一个汇总步骤整理最终结果。
- 如果审查不通过，失败流转应回到审查状态继续补充。
- 条件通过表示仍需继续迭代，默认也应回到当前状态补充证据或修正结论。

## 关键要点

1. 初始状态用 `"isInitial": true`（不是 `"initial"`）
2. 终止状态用 `"isFinal": true`（不是 `"final"`）
3. 转移目标用 `"to"`（不是 `"target"`）
4. 非终止状态必须有 3 条转移：pass、conditional_pass、fail，且条件来自当前状态 judge 的 verdict
5. 终止状态的 steps 和 transitions 都是空数组
6. projectRoot 必须是绝对路径（以 / 开头）
