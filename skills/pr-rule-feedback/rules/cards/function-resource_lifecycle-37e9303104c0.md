---
id: function-resource_lifecycle-37e9303104c0
dimension: function
category: resource_lifecycle
severity: high
always_on: true
rule_tier: hard
keyword_triggers: ["释放", "泄漏", "资源"]
file_globs: []
action_level: MUST
check_type: semantic
text_hash: 37e9303104c0
---

成对管理资源生命周期，所有错误路径都要正确释放，避免泄漏、重复释放或释放后使用。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「成对管理资源生命周期，所有错误路径都要正确释放，避免泄漏、重」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：成对管理资源生命周期，所有错误路径都要正确释放，避免泄漏、重复释放或释放后使用。
