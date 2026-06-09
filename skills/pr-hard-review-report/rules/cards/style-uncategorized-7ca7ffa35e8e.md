---
id: style-uncategorized-7ca7ffa35e8e
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["ExprKind", "Expression", "OperandsToString", "hasException", "判断", "扩展性差", "硬编码多个"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: MAY
check_type: semantic
text_hash: 7ca7ffa35e8e
---

Expression::OperandsToString 硬编码多个 ExprKind 判断 hasException，扩展性差

### 触发现象 (positive_signals)
- Expression::OperandsToString 硬编码多个 ExprKind 判断 hasException，扩展性差
- 硬编码了多个 ExprKind 类型判断，如果后续添加新的异常类型 Expression，需要手动修改此处
- diff 中出现 `GetExprMajorKind` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
- 可以在 Expression 类中添加一个辅助方法： - 或者使用 ExpressionWithException 基类的判断逻辑

### 评论模板
【Expression::OperandsToString 硬编码多个 ExprKind 判断 hasException，扩展性差】请给出 file:line 证据；若确认问题，说明影响与修复建议。
