---
id: function-boundary_overflow-e9406d11082a
dimension: function
category: boundary_overflow
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["Int64", "global", "pax", "paxGlobalDataBytes", "tar_reader", "大小", "溢出", "累加", "需防"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: e9406d11082a
---

tar_reader paxGlobalDataBytes 累加 global pax 大小，需防 Int64 溢出

### 触发现象 (positive_signals)
- tar_reader paxGlobalDataBytes 累加 global pax 大小，需防 Int64 溢出
- 新增 `paxGlobalDataBytes` 用于限制 global pax 大小，但累加时可能溢出

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认累加逻辑中有溢出检查

### 评论模板
【tar_reader paxGlobalDataBytes 累加 global pax 大小，需防 Int64 溢出】请给出 file:line 证据；若确认问题，说明影响与修复建议。
