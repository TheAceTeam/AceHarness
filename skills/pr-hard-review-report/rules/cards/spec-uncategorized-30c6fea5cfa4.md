---
id: spec-uncategorized-30c6fea5cfa4
dimension: spec
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: []
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 30c6fea5cfa4
---

保持与既有代码一致的规范与约定，相关改动需在同类位置统一处理，避免遗漏。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「保持与既有代码一致的规范与约定，相关改动需在同类位置统一处理」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：保持与既有代码一致的规范与约定，相关改动需在同类位置统一处理，避免遗漏。
