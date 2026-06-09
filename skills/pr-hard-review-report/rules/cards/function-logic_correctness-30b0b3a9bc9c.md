---
id: function-logic_correctness-30b0b3a9bc9c
dimension: function
category: logic_correctness
severity: medium
always_on: false
rule_tier: hard
keyword_triggers: ["分支", "不可达", "遗漏", "逻辑"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 30b0b3a9bc9c
---

校验逻辑正确性，关注不可达分支、状态不一致、死循环及遗漏的边界场景。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「校验逻辑正确性，关注不可达分支、状态不一致、死循环及遗漏的边」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：校验逻辑正确性，关注不可达分支、状态不一致、死循环及遗漏的边界场景。
