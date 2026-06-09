---
id: function-boundary_overflow-1e49af60351d
dimension: function
category: boundary_overflow
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["溢出", "精度", "类型转换"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 1e49af60351d
---

数值比较/类型转换需考虑精度、符号与溢出，遵循正确的数值与边界语义。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「数值比较/类型转换需考虑精度、符号与溢出，遵循正确的数值与边」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：数值比较/类型转换需考虑精度、符号与溢出，遵循正确的数值与边界语义。
