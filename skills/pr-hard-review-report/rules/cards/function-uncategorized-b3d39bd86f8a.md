---
id: function-uncategorized-b3d39bd86f8a
dimension: function
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["ParseHeapDump", "void", "仍返回", "完整数据", "等解析失败仅打印", "调用方无法感知不"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: b3d39bd86f8a
---

ParseHeapDump 等解析失败仅打印仍返回 void，调用方无法感知不完整数据

### 触发现象 (positive_signals)
- ParseHeapDump 等解析失败仅打印仍返回 void，调用方无法感知不完整数据

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【ParseHeapDump 等解析失败仅打印仍返回 void，调用方无法感知不完整数据】请给出 file:line 证据；若确认问题，说明影响与修复建议。
