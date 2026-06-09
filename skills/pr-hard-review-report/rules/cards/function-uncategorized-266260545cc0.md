---
id: function-uncategorized-266260545cc0
dimension: function
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["Windows", "process", "命令行转义需覆盖", "确认规则完整", "等特殊字符"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 266260545cc0
---

process Windows 命令行转义需覆盖 ^ % 等特殊字符，确认规则完整

### 触发现象 (positive_signals)
- process Windows 命令行转义需覆盖 ^ % 等特殊字符，确认规则完整
- Windows 命令行转义使用 `^` 字符

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
1. 检查是否需要处理 `&`, `|`, `<`, `>` 等命令分隔符 2. 如果参数已用双引号包裹，这些字符可能已安全（需验证） 3. 建议添加测试覆盖各种特殊字符组合

### 评论模板
【process Windows 命令行转义需覆盖 ^ % 等特殊字符，确认规则完整】请给出 file:line 证据；若确认问题，说明影响与修复建议。
