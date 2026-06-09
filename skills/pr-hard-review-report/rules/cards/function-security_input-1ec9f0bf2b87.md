---
id: function-security_input-1ec9f0bf2b87
dimension: function
category: security_input
severity: high
always_on: true
rule_tier: hard
keyword_triggers: ["注入", "不可信", "校验", "安全"]
file_globs: []
action_level: MUST
check_type: semantic
text_hash: 1ec9f0bf2b87
---

对外部/不可信输入做校验与边界防护，关注安全风险（注入、越权、敏感信息泄露等）。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「对外部/不可信输入做校验与边界防护，关注安全风险（注入、越权」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：对外部/不可信输入做校验与边界防护，关注安全风险（注入、越权、敏感信息泄露等）。
