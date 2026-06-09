---
id: style-uncategorized-2140261d2672
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["Int64.Max", "LibC.mallocCString", "length", "malloc", "str.size", "应前置边界检查", "溢出"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: static
text_hash: 2140261d2672
---

LibC.mallocCString 对 str.size==Int64.Max 时 length+1 溢出，应前置边界检查

### 触发现象 (positive_signals)
- LibC.mallocCString 对 str.size==Int64.Max 时 length+1 溢出，应前置边界检查
- 如果 `str
- diff 中出现 `LibC.malloc` 或同类变更
- diff 中出现 `LibC.mallocCString` 或同类变更
- diff 中出现 `mallocCString` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【LibC.mallocCString 对 str.size==Int64.Max 时 length+1 溢出，应前置边界检查】请给出 file:line 证据；若确认问题，说明影响与修复建议。
