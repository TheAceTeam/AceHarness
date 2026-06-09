---
id: spec-uncategorized-afb4dbb06bdd
dimension: spec
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: []
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: afb4dbb06bdd
---

涉及跨平台、目标架构或构建选项的改动，应覆盖各平台差异并避免引入平台专属假设。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「涉及跨平台、目标架构或构建选项的改动，应覆盖各平台差异并避免」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：涉及跨平台、目标架构或构建选项的改动，应覆盖各平台差异并避免引入平台专属假设。
