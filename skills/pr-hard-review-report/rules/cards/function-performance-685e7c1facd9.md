---
id: function-performance-685e7c1facd9
dimension: function
category: performance
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["Random", "threshold", "upper", "while", "拒绝采样", "时更明显", "概率极低", "理论上可无限循环"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 685e7c1facd9
---

Random 拒绝采样 while(r>threshold) 理论上可无限循环（概率极低），大 upper 时更明显

### 触发现象 (positive_signals)
- Random 拒绝采样 while(r>threshold) 理论上可无限循环（概率极低），大 upper 时更明显
- 拒绝采样在理论上可能导致无限循环（虽然概率极低）

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
当前实现符合标准做法。如果需要更强的保障，可以考虑添加最大重试次数限制并抛出异常，但这会改变 API 行为。建议保持当前实现，因为这是随机数生成的标准做法。

### 关联规则 (related_rules)
- `style-uncategorized-a167a8eefd0c`

### 评论模板
【Random 拒绝采样 while(r>threshold) 理论上可无限循环（概率极低），大 upper 时更明显】请给出 file:line 证据；若确认问题，说明影响与修复建议。
