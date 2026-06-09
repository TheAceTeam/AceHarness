---
id: style-uncategorized-a167a8eefd0c
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["nextInt8", "upper", "存在与无符号函数", "相同的模偏移偏差", "过滤负数后直接取"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: a167a8eefd0c
---

nextInt8/16/32/64(upper) 过滤负数后直接取模，存在与无符号函数相同的模偏移偏差

### 触发现象 (positive_signals)
- nextInt8/16/32/64(upper) 过滤负数后直接取模，存在与无符号函数相同的模偏移偏差
- `nextInt8(upper)`, `nextInt16(upper)`, `nextInt32(upper)`, `nextInt64(upper)` 四个有符号整数函数存在与无符号函数相同的模偏移问题

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
对有符号整数函数同样应用拒绝采样方法：

### 关联规则 (related_rules)
- `function-performance-685e7c1facd9`

### 评论模板
【nextInt8/16/32/64(upper) 过滤负数后直接取模，存在与无符号函数相同的模偏移偏差】请给出 file:line 证据；若确认问题，说明影响与修复建议。
