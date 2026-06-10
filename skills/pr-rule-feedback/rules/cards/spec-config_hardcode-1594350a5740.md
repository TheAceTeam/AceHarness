---
id: spec-config_hardcode-1594350a5740
dimension: spec
category: config_hardcode
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["硬编码"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 1594350a5740
---

禁止硬编码绝对/临时路径、写死的偏移等环境相关值，应参数化或使用相对路径/配置。

### 触发现象 (positive_signals)
- diff 中出现与规则主题「禁止硬编码绝对/临时路径、写死的偏移等环境相关值，应参数化或」相关的变化时应检查

### 误报边界 (negative_guards)
- 若上下文表明已满足团队约定例外，可标为需确认而非必须修复

### 审查问题 (review_questions)
- 能否在 diff 中找到支持该问题的具体代码证据？
- 是否存在规则描述的例外场景？

### 评论模板
请按规则检查：禁止硬编码绝对/临时路径、写死的偏移等环境相关值，应参数化或使用相对路径/配置。
