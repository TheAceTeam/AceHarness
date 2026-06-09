---
id: spec-reuse_dry-00bbb1c58359
dimension: spec
category: reuse_dry
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["复用", "重复定义", "公共"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 00bbb1c58359
---

优先复用已有的常量/函数/工具，相似逻辑提取公共实现，避免重复定义。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「优先复用已有的常量/函数/工具，相似逻辑提取公共实现，避免重」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：优先复用已有的常量/函数/工具，相似逻辑提取公共实现，避免重复定义。
