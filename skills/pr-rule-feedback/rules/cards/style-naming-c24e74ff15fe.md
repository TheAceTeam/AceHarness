---
id: style-naming-c24e74ff15fe
dimension: style
category: naming
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["命名", "标识符", "表意", "拼写"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: c24e74ff15fe
---

标识符命名应准确表意、与其类型和语义一致；发现误导性或拼写错误的命名应及时重命名。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「标识符命名应准确表意、与其类型和语义一致；发现误导性或拼写错」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：标识符命名应准确表意、与其类型和语义一致；发现误导性或拼写错误的命名应及时重命名。
