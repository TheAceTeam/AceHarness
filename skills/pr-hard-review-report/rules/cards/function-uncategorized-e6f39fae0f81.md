---
id: function-uncategorized-e6f39fae0f81
dimension: function
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["Comparable", "IEEE", "NaN", "totalOrder", "不同", "排序可能不符合预", "视为大于非"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: e6f39fae0f81
---

Comparable 将 NaN 视为大于非 NaN，与 IEEE totalOrder 不同，排序可能不符合预期

### 触发现象 (positive_signals)
- Comparable 将 NaN 视为大于非 NaN，与 IEEE totalOrder 不同，排序可能不符合预期
- 当前实现将 NaN 视为大于所有非 NaN 值（`NaN > non-NaN → Ordering

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
在文档中明确说明 NaN 比较的语义，或考虑使用更符合常规排序习惯的语义（NaN 小于所有数值）。这是设计决策，不影响当前修复的正确性。

### 评论模板
【Comparable 将 NaN 视为大于非 NaN，与 IEEE totalOrder 不同，排序可能不符合预期】请给出 file:line 证据；若确认问题，说明影响与修复建议。
