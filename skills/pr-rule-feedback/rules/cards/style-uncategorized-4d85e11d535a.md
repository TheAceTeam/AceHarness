---
id: style-uncategorized-4d85e11d535a
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["lock", "mux", "resource_pool", "synchronized", "unlock", "一致", "使用", "规范是否与", "语法", "需确认仓颉互斥锁"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: 4d85e11d535a
---

resource_pool 使用 synchronized(mux) 语法，需确认仓颉互斥锁规范是否与 lock/unlock 一致

### 触发现象 (positive_signals)
- resource_pool 使用 synchronized(mux) 语法，需确认仓颉互斥锁规范是否与 lock/unlock 一致
- Cangjie 语言中 `synchronized` 语法是否正确

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认 Cangjie 语法规范，或参考其他代码中的互斥锁使用方式

### 评论模板
【resource_pool 使用 synchronized(mux) 语法，需确认仓颉互斥锁规范是否与 lock/unlock 一致】请给出 file:line 证据；若确认问题，说明影响与修复建议。
