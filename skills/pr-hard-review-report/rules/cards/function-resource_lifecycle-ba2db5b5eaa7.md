---
id: function-resource_lifecycle-ba2db5b5eaa7
dimension: function
category: resource_lifecycle
severity: low
always_on: true
rule_tier: hard
keyword_triggers: ["cache", "cacheSize", "size", "unittest", "否应为", "溢出条件用", "边界语义需确认是"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: ba2db5b5eaa7
---

JSON unittest cache 溢出条件用 cacheSize+1>=size，边界语义需确认是否应为 >

### 触发现象 (positive_signals)
- JSON unittest cache 溢出条件用 cacheSize+1>=size，边界语义需确认是否应为 >
- 检查条件 `parser
- diff 中出现 `parser.cache.size` 或同类变更
- diff 中出现 `parser.cacheSize` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认是否应该改为 `>` 以充分利用缓存空间：

### 评论模板
【JSON unittest cache 溢出条件用 cacheSize+1>=size，边界语义需确认是否应为 >】请给出 file:line 证据；若确认问题，说明影响与修复建议。
