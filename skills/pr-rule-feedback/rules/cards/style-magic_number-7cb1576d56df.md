---
id: style-magic_number-7cb1576d56df
dimension: style
category: magic_number
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["MAX_FLOAT_PRECISION", "MAX_FORMAT_WIDTH", "parseFormat", "precision", "浮点应使用", "限制"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 7cb1576d56df
---

parseFormat 用 MAX_FORMAT_WIDTH 限制 precision，浮点应使用 MAX_FLOAT_PRECISION

### 触发现象 (positive_signals)
- parseFormat 用 MAX_FORMAT_WIDTH 限制 precision，浮点应使用 MAX_FLOAT_PRECISION
- 定义了常量 `MAX_FORMAT_WIDTH` 和 `MAX_FLOAT_PRECISION`，但在 `parseFormat` 中检查 `precision > MAX_FORMAT_WIDTH`，而在浮点函数中检查 `precision > MAX_FLOAT_PRECISION`
- diff 中出现 `parseFormat` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
考虑将格式宽度和精度使用不同的常量，或添加注释说明为何使用相同值。

### 评论模板
【parseFormat 用 MAX_FORMAT_WIDTH 限制 precision，浮点应使用 MAX_FLOAT_PRECISION】请给出 file:line 证据；若确认问题，说明影响与修复建议。
