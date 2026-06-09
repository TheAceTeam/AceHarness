---
id: spec-api_abi_compat-7857a90a806a
dimension: spec
category: api_abi_compat
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["CPointerResource", "UAF", "private", "value", "修复", "可能破坏直接访问", "字段的现有代码", "需迁移路径"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: 7857a90a806a
---

CPointerResource value 改 private 修复 UAF 可能破坏直接访问字段的现有代码，需迁移路径

### 触发现象 (positive_signals)
- CPointerResource value 改 private 修复 UAF 可能破坏直接访问字段的现有代码，需迁移路径
- 将 `value` 字段设为 private 会破坏直接访问该字段的现有代码

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
添加 @deprecated 注解和迁移指南，提供公共 getter/setter 接口

### 关联规则 (related_rules)
- `function-boundary_overflow-8b1889127f2c`
- `style-uncategorized-6826810dfc2d`
- `style-uncategorized-f5b29fbff363`

### 评论模板
【CPointerResource value 改 private 修复 UAF 可能破坏直接访问字段的现有代码，需迁移路径】请给出 file:line 证据；若确认问题，说明影响与修复建议。
