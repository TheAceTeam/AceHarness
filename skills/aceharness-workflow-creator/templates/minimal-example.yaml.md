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

## 完整输出

<result>
{"kind":"workflow_draft","payload":{"filename":"minimal-review.yaml","summary":"最小代码审查工作流","config":{"workflow":{"states":[{"name":"审查","isInitial":true,"steps":[{"name":"执行审查","agent":"reviewer","prompt":"审查代码质量"}],"transitions":[{"to":"完成","condition":{"verdict":"pass"}},{"to":"完成","condition":{"verdict":"conditional_pass"}},{"to":"审查","condition":{"verdict":"fail"}}]},{"name":"完成","isFinal":true,"steps":[],"transitions":[]}]},"context":{"projectRoot":"/Users/example/project","workspaceMode":"in-place"}}}}
</result>

## 关键要点

1. 初始状态用 `"isInitial": true`（不是 `"initial"`）
2. 终止状态用 `"isFinal": true`（不是 `"final"`）
3. 转移目标用 `"to"`（不是 `"target"`）
4. 非终止状态必须有 3 条转移：pass、conditional_pass、fail
5. 终止状态的 steps 和 transitions 都是空数组
6. projectRoot 必须是绝对路径（以 / 开头）
