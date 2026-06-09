---
id: style-complexity-b6e12fb8d482
dimension: style
category: complexity
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["过长", "嵌套", "拆分", "子函数"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: b6e12fb8d482
---

过长或嵌套过深的函数/判断条件应拆分或提取子函数，降低复杂度、提升可读性。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「过长或嵌套过深的函数/判断条件应拆分或提取子函数，降低复杂度」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：过长或嵌套过深的函数/判断条件应拆分或提取子函数，降低复杂度、提升可读性。
