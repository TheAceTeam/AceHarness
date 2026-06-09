---
id: style-error_message-742c0bbdf440
dimension: style
category: error_message
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["错误信息", "文案", "用户可见", "误导"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 742c0bbdf440
---

错误信息和用户可见文案应准确、清晰、可定位，避免含糊或误导性表达。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「错误信息和用户可见文案应准确、清晰、可定位，避免含糊或误导性」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：错误信息和用户可见文案应准确、清晰、可定位，避免含糊或误导性表达。
