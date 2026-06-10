---
id: style-uncategorized-473d265aa578
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["env.getVariable", "key", "setVariable", "一样拒绝", "未像", "校验不一致"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 473d265aa578
---

env.getVariable 未像 setVariable 一样拒绝 key 含 '='，校验不一致

### 触发现象 (positive_signals)
- env.getVariable 未像 setVariable 一样拒绝 key 含 '='，校验不一致
- `setVariable` 添加了 `=` 字符验证，但 `getVariable` 没有

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
在 `getVariable` 中添加相同的验证：

### 关联规则 (related_rules)
- `style-uncategorized-a4fafbc14291`

### 评论模板
【env.getVariable 未像 setVariable 一样拒绝 key 含 '='，校验不一致】请给出 file:line 证据；若确认问题，说明影响与修复建议。
