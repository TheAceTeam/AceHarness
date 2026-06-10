---
id: function-uncategorized-ed59d7c3ab1c
dimension: function
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["GetFileID", "cjmp", "fileId", "hash", "optional", "常为负", "或重构", "表无效的", "语义失效"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: ed59d7c3ab1c
---

cjmp 下 fileId 取 hash 常为负，原 -1 表无效的 GetFileID 语义失效，需 optional 或重构

### 触发现象 (positive_signals)
- cjmp 下 fileId 取 hash 常为负，原 -1 表无效的 GetFileID 语义失效，需 optional 或重构
- diff 中出现 `GetFileID` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【cjmp 下 fileId 取 hash 常为负，原 -1 表无效的 GetFileID 语义失效，需 optional 或重构】请给出 file:line 证据；若确认问题，说明影响与修复建议。
