---
id: function-concurrency-13fe18275149
dimension: function
category: concurrency
severity: medium
always_on: false
rule_tier: hard
keyword_triggers: ["线程", "竞态", "同步", "并发"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 13fe18275149
---

多线程访问的共享状态必须保证并发安全，识别竞态条件并加适当同步。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「多线程访问的共享状态必须保证并发安全，识别竞态条件并加适当同」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：多线程访问的共享状态必须保证并发安全，识别竞态条件并加适当同步。
