---
id: style-uncategorized-b563bafaeb02
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["CJC", "ICE", "VArray", "_NSHandler", "jumpState", "初始化形式", "初始化错误触发", "需用正确"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: b563bafaeb02
---

VArray/jumpState 初始化错误触发 CJC ICE（#884），需用正确 _NSHandler 初始化形式

### 触发现象 (positive_signals)
- VArray/jumpState 初始化错误触发 CJC ICE（#884），需用正确 _NSHandler 初始化形式

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【VArray/jumpState 初始化错误触发 CJC ICE（#884），需用正确 _NSHandler 初始化形式】请给出 file:line 证据；若确认问题，说明影响与修复建议。
