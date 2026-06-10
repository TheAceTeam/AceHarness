---
id: style-uncategorized-4eb7f474af97
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["Array.splitAt", "bugfix", "left", "len", "mid", "start", "参数从", "否为", "改为", "语义变更需确认是"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: 4eb7f474af97
---

Array.splitAt left 的 len 参数从 start+mid 改为 mid，语义变更需确认是否为 bugfix

### 触发现象 (positive_signals)
- Array.splitAt left 的 len 参数从 start+mid 改为 mid，语义变更需确认是否为 bugfix
- 原代码是 `Array<T>(this

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认 Array 的构造函数参数含义：`Array(rawptr, start, len)` 中 `len` 是长度还是结束位置。如果 `len` 是长度，则新代码正确；如果 `len` 是结束索引，则需要验证。

### 评论模板
【Array.splitAt left 的 len 参数从 start+mid 改为 mid，语义变更需确认是否为 bugfix】请给出 file:line 证据；若确认问题，说明影响与修复建议。
