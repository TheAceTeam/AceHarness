---
id: function-performance-1c835df0718e
dimension: function
category: performance
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["循环", "高频", "性能"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 1c835df0718e
---

关注热点路径性能，避免在高频循环中重复创建/释放资源或进行冗余计算。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「关注热点路径性能，避免在高频循环中重复创建/释放资源或进行冗」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：关注热点路径性能，避免在高频循环中重复创建/释放资源或进行冗余计算。
