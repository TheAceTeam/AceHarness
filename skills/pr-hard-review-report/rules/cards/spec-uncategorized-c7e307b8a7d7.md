---
id: spec-uncategorized-c7e307b8a7d7
dimension: spec
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["Block", "Branch.trueTarget", "getOrThrow", "operands", "会抛异常", "直接", "类型不符时公开"]
file_globs: ["**/*.cj", "**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: c7e307b8a7d7
---

Branch.trueTarget 对 operands[1] 直接 as Block + getOrThrow，类型不符时公开 API 会抛异常

### 触发现象 (positive_signals)
- Branch.trueTarget 对 operands[1] 直接 as Block + getOrThrow，类型不符时公开 API 会抛异常
- `trueTarget` 属性直接使用 `getOrThrow()`，如果 operands[1] 不是 Block 类型或不存在，会抛出异常

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
考虑添加前置条件检查或使用更安全的访问方式：

### 评论模板
【Branch.trueTarget 对 operands[1] 直接 as Block + getOrThrow，类型不符时公开 API 会抛异常】请给出 file:line 证据；若确认问题，说明影响与修复建议。
