---
id: style-uncategorized-5bc774408dc8
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["DynamicCast", "init", "nullptr", "paramDftValHostFuncDecl", "中间变量", "简化", "赋值可用", "避免重复"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 5bc774408dc8
---

paramDftValHostFuncDecl 赋值可用 if-init 简化，避免重复 DynamicCast 与 nullptr 中间变量

### 触发现象 (positive_signals)
- paramDftValHostFuncDecl 赋值可用 if-init 简化，避免重复 DynamicCast 与 nullptr 中间变量
- diff 中出现 `GetBody` 或同类变更
- diff 中出现 `GetId` 或同类变更
- diff 中出现 `obj.GetParamDftValHostFunc` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【paramDftValHostFuncDecl 赋值可用 if-init 简化，避免重复 DynamicCast 与 nullptr 中间变量】请给出 file:line 证据；若确认问题，说明影响与修复建议。
