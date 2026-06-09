---
id: style-formatting-6773dec86010
dimension: style
category: formatting
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["空格", "缩进", "换行", "运算符", "括号", "排版"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 6773dec86010
---

遵循统一的排版规范：运算符/关键字/括号周围留必要空格，缩进、换行、空行保持一致。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「遵循统一的排版规范：运算符/关键字/括号周围留必要空格，缩进」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：遵循统一的排版规范：运算符/关键字/括号周围留必要空格，缩进、换行、空行保持一致。
