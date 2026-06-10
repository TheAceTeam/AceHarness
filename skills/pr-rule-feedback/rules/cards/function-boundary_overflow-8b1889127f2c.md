---
id: function-boundary_overflow-8b1889127f2c
dimension: function
category: boundary_overflow
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["CPointer", "Int64.Min", "minus", "offset", "overflow", "乘法溢出路径可能", "仅检查", "未覆盖"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 8b1889127f2c
---

CPointer minus 仅检查 offset==Int64.Min，(-1)*offset 乘法溢出路径可能未覆盖

### 触发现象 (positive_signals)
- CPointer minus 仅检查 offset==Int64.Min，(-1)*offset 乘法溢出路径可能未覆盖
- 仅检查 `Int64

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
添加指针范围检查或使用更安全的计算方式：

### 关联规则 (related_rules)
- `spec-api_abi_compat-7857a90a806a`
- `style-uncategorized-6826810dfc2d`
- `style-uncategorized-f5b29fbff363`

### 评论模板
【CPointer minus 仅检查 offset==Int64.Min，(-1)*offset 乘法溢出路径可能未覆盖】请给出 file:line 证据；若确认问题，说明影响与修复建议。
