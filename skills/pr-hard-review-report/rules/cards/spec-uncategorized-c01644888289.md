---
id: spec-uncategorized-c01644888289
dimension: spec
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: []
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: c01644888289
---

新增或修复行为应补充能覆盖关键路径、边界条件和回归场景的测试。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「新增或修复行为应补充能覆盖关键路径、边界条件和回归场景的测试」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：新增或修复行为应补充能覆盖关键路径、边界条件和回归场景的测试。
