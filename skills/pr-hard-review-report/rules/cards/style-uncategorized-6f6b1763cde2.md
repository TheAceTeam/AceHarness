---
id: style-uncategorized-6f6b1763cde2
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["admin", "readStringUnquoted", "true", "为非标准", "供选项", "的破坏性变更", "移除", "需评估兼容性或提"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: 6f6b1763cde2
---

移除 readStringUnquoted 为非标准 JSON（如 {admin:true}）的破坏性变更，需评估兼容性或提供选项

### 触发现象 (positive_signals)
- 移除 readStringUnquoted 为非标准 JSON（如 {admin:true}）的破坏性变更，需评估兼容性或提供选项
- 移除了 `readStringUnquoted` 方法，不再支持非标准 JSON 格式如 `{admin: true}` 或 `{admin: tom}`

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
1. 确认是否有现有代码依赖非标准 JSON 解析 2. 如果有，考虑提供兼容模式选项（如 `JsonReaderOptions(allowUnquotedKeys: true)`） 3. 在 Release Notes 中明确标注此破坏性变更

### 评论模板
【移除 readStringUnquoted 为非标准 JSON（如 {admin:true}）的破坏性变更，需评估兼容性或提供选项】请给出 file:line 证据；若确认问题，说明影响与修复建议。
