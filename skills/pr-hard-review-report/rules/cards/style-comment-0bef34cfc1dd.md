---
id: style-comment-0bef34cfc1dd
dimension: style
category: comment
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["注释", "过时"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 0bef34cfc1dd
---

注释应准确且必要：补充难理解逻辑的意图说明，删除冗余、过时或与代码不符的注释。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「注释应准确且必要：补充难理解逻辑的意图说明，删除冗余、过时或」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：注释应准确且必要：补充难理解逻辑的意图说明，删除冗余、过时或与代码不符的注释。
