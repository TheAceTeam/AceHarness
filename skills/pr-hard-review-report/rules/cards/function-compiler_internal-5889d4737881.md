---
id: function-compiler_internal-5889d4737881
dimension: function
category: compiler_internal
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["ABI", "OptionLikeNonRef", "chirEnumType", "enum", "可能导致", "布局不兼容", "构造误用", "类型", "类型参数作关联值"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: 5889d4737881
---

OptionLikeNonRef enum 构造误用 chirEnumType 类型参数作关联值类型，可能导致 ABI/布局不兼容

### 触发现象 (positive_signals)
- OptionLikeNonRef enum 构造误用 chirEnumType 类型参数作关联值类型，可能导致 ABI/布局不兼容

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【OptionLikeNonRef enum 构造误用 chirEnumType 类型参数作关联值类型，可能导致 ABI/布局不兼容】请给出 file:line 证据；若确认问题，说明影响与修复建议。
