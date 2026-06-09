---
id: function-resource_lifecycle-2029bd3adf51
dimension: function
category: resource_lifecycle
severity: high
always_on: true
rule_tier: hard
keyword_triggers: ["释放", "资源"]
file_globs: []
action_level: MUST
check_type: semantic
text_hash: 2029bd3adf51
---

引入缓存、全局状态或单例初始化时，应明确失效、并发和资源释放语义。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「引入缓存、全局状态或单例初始化时，应明确失效、并发和资源释放」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：引入缓存、全局状态或单例初始化时，应明确失效、并发和资源释放语义。
