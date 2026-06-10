---
id: function-assertion_precondition-5be8f689e42d
dimension: function
category: assertion_precondition
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["校验"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 5be8f689e42d
---

对指针/可空值进行判空校验，避免空引用导致的崩溃。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「对指针/可空值进行判空校验，避免空引用导致的崩溃。」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：对指针/可空值进行判空校验，避免空引用导致的崩溃。
