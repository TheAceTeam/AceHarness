---
id: function-null_safety-780fa5557e3b
dimension: function
category: null_safety
severity: medium
always_on: true
rule_tier: hard
keyword_triggers: ["IsPendingSafePoint", "LOG", "false", "null", "nullptr", "return", "tlData", "关键路径应终止或", "抛错"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: 780fa5557e3b
---

IsPendingSafePoint 遇 null tlData 仅 LOG 后 return false，关键路径应终止或抛错

### 触发现象 (positive_signals)
- IsPendingSafePoint 遇 null tlData 仅 LOG 后 return false，关键路径应终止或抛错
- 仅记录错误日志后返回 false，可能导致后续逻辑错误

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【IsPendingSafePoint 遇 null tlData 仅 LOG 后 return false，关键路径应终止或抛错】请给出 file:line 证据；若确认问题，说明影响与修复建议。
