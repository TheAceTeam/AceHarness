---
id: style-dead_code-5b6627ee013e
dimension: style
category: dead_code
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["冗余", "无用", "导入", "声明"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 5b6627ee013e
---

及时清理冗余、重复或无用的代码、导入和声明，保持改动最小且聚焦。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「及时清理冗余、重复或无用的代码、导入和声明，保持改动最小且聚」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：及时清理冗余、重复或无用的代码、导入和声明，保持改动最小且聚焦。
