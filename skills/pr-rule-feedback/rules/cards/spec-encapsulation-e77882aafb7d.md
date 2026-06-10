---
id: spec-encapsulation-e77882aafb7d
dimension: spec
category: encapsulation
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["封装", "暴露", "隐藏实现"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: e77882aafb7d
---

对外能力应通过良好封装的接口暴露，隐藏实现细节，保持接口稳定清晰。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「对外能力应通过良好封装的接口暴露，隐藏实现细节，保持接口稳定」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：对外能力应通过良好封装的接口暴露，隐藏实现细节，保持接口稳定清晰。
