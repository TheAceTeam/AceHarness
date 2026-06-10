---
id: style-magic_number-e700f43662cd
dimension: style
category: magic_number
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["魔法", "字面量", "常量"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: e700f43662cd
---

避免散落的魔法数字/字面量，抽取为有语义的命名常量。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「避免散落的魔法数字/字面量，抽取为有语义的命名常量。」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：避免散落的魔法数字/字面量，抽取为有语义的命名常量。
