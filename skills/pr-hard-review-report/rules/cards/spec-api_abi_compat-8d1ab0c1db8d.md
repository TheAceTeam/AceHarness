---
id: spec-api_abi_compat-8d1ab0c1db8d
dimension: spec
category: api_abi_compat
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["public", "ABI"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 8d1ab0c1db8d
---

改动 public API/成员需评估 API/ABI 兼容性；破坏性变更须经评审并在说明中标注。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「改动 public API/成员需评估 API/ABI 兼容」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：改动 public API/成员需评估 API/ABI 兼容性；破坏性变更须经评审并在说明中标注。
