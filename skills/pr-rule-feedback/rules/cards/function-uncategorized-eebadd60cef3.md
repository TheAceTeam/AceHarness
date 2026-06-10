---
id: function-uncategorized-eebadd60cef3
dimension: function
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["Error", "pcArray", "protected", "traceElementArray", "var", "外部直接访问字段", "的代码会编译失败"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: eebadd60cef3
---

Error pcArray/traceElementArray 改 protected var，外部直接访问字段的代码会编译失败

### 触发现象 (positive_signals)
- Error pcArray/traceElementArray 改 protected var，外部直接访问字段的代码会编译失败
- 将 `var` 改为 `protected var`，可能影响直接访问这些字段的外部代码

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
检查是否有外部代码依赖这些字段的访问

### 评论模板
【Error pcArray/traceElementArray 改 protected var，外部直接访问字段的代码会编译失败】请给出 file:line 证据；若确认问题，说明影响与修复建议。
