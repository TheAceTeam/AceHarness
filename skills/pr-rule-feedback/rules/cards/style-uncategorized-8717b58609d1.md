---
id: style-uncategorized-8717b58609d1
dimension: style
category: uncategorized
severity: high
always_on: false
rule_tier: soft
keyword_triggers: ["Content-Length", "HttpNormalBody", "contentLength", "data.size", "remainingLength", "初始化为", "可能越界读", "而非"]
file_globs: ["**/*.cj"]
action_level: MUST
check_type: semantic
text_hash: 8717b58609d1
---

HttpNormalBody remainingLength 初始化为 contentLength 而非 data.size，可能越界读

### 触发现象 (positive_signals)
- HttpNormalBody remainingLength 初始化为 contentLength 而非 data.size，可能越界读
- `remainingLength` 初始化为 `contentLength`（服务器声称的长度），但实际读取的数据量是 `data

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
修改为 `remainingLength = data.size`，使用实际读取的数据量而非声称的长度： 或者修改 `length` 属性返回实际数据量：

### 评论模板
【HttpNormalBody remainingLength 初始化为 contentLength 而非 data.size，可能越界读】请给出 file:line 证据；若确认问题，说明影响与修复建议。
