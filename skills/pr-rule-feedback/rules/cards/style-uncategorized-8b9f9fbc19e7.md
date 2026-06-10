---
id: style-uncategorized-8b9f9fbc19e7
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["BinaryExpression", "Div", "div", "division", "maybe", "overflow", "zero", "应为", "构造抛错英文", "表述不准"]
file_globs: ["**/*.cj", "**/*.cpp", "**/*.h"]
action_level: MAY
check_type: semantic
text_hash: 8b9f9fbc19e7
---

BinaryExpression Div 构造抛错英文 "maybe div 0" 表述不准，应为 division by zero

### 触发现象 (positive_signals)
- BinaryExpression Div 构造抛错英文 "maybe div 0" 表述不准，应为 division by zero
- 注释中的英文表达不够准确："maybe you could div 0 in runtime" 应为 "division by zero may occur at runtime"

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
修正注释为更准确的英文表达，或使用中文注释。

### 评论模板
【BinaryExpression Div 构造抛错英文 "maybe div 0" 表述不准，应为 division by zero】请给出 file:line 证据；若确认问题，说明影响与修复建议。
