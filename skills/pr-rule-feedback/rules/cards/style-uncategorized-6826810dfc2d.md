---
id: style-uncategorized-6826810dfc2d
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["CPointer", "OverflowWrapping", "addPointer", "overflow", "内部仍有溢出防护", "减法移除", "改手动检查", "需确认"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: 6826810dfc2d
---

CPointer 减法移除 @OverflowWrapping 改手动检查，需确认 addPointer 内部仍有溢出防护

### 触发现象 (positive_signals)
- CPointer 减法移除 @OverflowWrapping 改手动检查，需确认 addPointer 内部仍有溢出防护
- 移除了 `@OverflowWrapping` 注解，改为手动检查

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认 `addPointer` 是否处理其他溢出情况（如 `offset * (-1)` 溢出）

### 关联规则 (related_rules)
- `function-boundary_overflow-8b1889127f2c`
- `spec-api_abi_compat-7857a90a806a`
- `style-uncategorized-f5b29fbff363`

### 评论模板
【CPointer 减法移除 @OverflowWrapping 改手动检查，需确认 addPointer 内部仍有溢出防护】请给出 file:line 证据；若确认问题，说明影响与修复建议。
