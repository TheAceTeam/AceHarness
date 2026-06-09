---
id: style-uncategorized-975529c1ce05
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["TreeMap", "entrySize", "quickEquals", "refEq", "内容比较语义变更", "改为仅", "需确认意图"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 975529c1ce05
---

TreeMap quickEquals 改为仅 refEq，原 entrySize 内容比较语义变更需确认意图

### 触发现象 (positive_signals)
- TreeMap quickEquals 改为仅 refEq，原 entrySize 内容比较语义变更需确认意图
- 原实现检查 `entrySize` 相等后再比较 key，新实现直接使用引用相等

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认此修改是否符合 TreeMap 的设计意图，如果是，建议在 commit message 或代码注释中说明变更原因。

### 评论模板
【TreeMap quickEquals 改为仅 refEq，原 entrySize 内容比较语义变更需确认意图】请给出 file:line 证据；若确认问题，说明影响与修复建议。
