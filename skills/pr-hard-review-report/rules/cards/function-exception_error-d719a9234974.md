---
id: function-exception_error-d719a9234974
dimension: function
category: exception_error
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["异常", "错误码"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: d719a9234974
---

统一错误码/异常语义，检查并妥善处理返回值与异常路径，不吞掉错误。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「统一错误码/异常语义，检查并妥善处理返回值与异常路径，不吞掉」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：统一错误码/异常语义，检查并妥善处理返回值与异常路径，不吞掉错误。
