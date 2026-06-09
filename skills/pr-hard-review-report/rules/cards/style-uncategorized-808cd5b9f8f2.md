---
id: style-uncategorized-808cd5b9f8f2
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["checksum", "encodeChecksumTo", "tar", "target", "直接写入目标数组", "编码可简化为"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 808cd5b9f8f2
---

tar checksum 编码可简化为 encodeChecksumTo(target) 直接写入目标数组

### 触发现象 (positive_signals)
- tar checksum 编码可简化为 encodeChecksumTo(target) 直接写入目标数组

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【tar checksum 编码可简化为 encodeChecksumTo(target) 直接写入目标数组】请给出 file:line 证据；若确认问题，说明影响与修复建议。
