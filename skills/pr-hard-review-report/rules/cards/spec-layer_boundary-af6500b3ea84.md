---
id: spec-layer_boundary-af6500b3ea84
dimension: spec
category: layer_boundary
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["模块", "分层", "依赖"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: af6500b3ea84
---

遵守模块/分层职责边界：类型与逻辑放在恰当的层和文件，避免跨层耦合与不当依赖。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「遵守模块/分层职责边界：类型与逻辑放在恰当的层和文件，避免跨」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：遵守模块/分层职责边界：类型与逻辑放在恰当的层和文件，避免跨层耦合与不当依赖。
