---
id: function-boundary_overflow-2dbdace8dc27
dimension: function
category: boundary_overflow
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["异常", "Option", "Monad", "抛出", "错误码"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 2dbdace8dc27
---

编码/序列化处理应遵循规范语义，正确处理多字节、边界与异常输入。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「编码/序列化处理应遵循规范语义，正确处理多字节、边界与异常输」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：编码/序列化处理应遵循规范语义，正确处理多字节、边界与异常输入。
