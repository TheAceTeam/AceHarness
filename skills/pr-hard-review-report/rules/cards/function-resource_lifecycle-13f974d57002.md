---
id: function-resource_lifecycle-13f974d57002
dimension: function
category: resource_lifecycle
severity: medium
always_on: true
rule_tier: hard
keyword_triggers: ["ANSI", "ColorSingleton", "Windows", "始化", "应构造开头设默认", "早退路径下部分", "颜色成员可能未初"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: 13f974d57002
---

ColorSingleton Windows 早退路径下部分 ANSI 颜色成员可能未初始化，应构造开头设默认值

### 触发现象 (positive_signals)
- ColorSingleton Windows 早退路径下部分 ANSI 颜色成员可能未初始化，应构造开头设默认值
- ColorSingleton构造函数在Windows平台早期返回时，部分ANSI颜色字符串可能未初始化

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
在构造函数开始处添加默认初始化：

### 关联规则 (related_rules)
- `style-uncategorized-fd030da0fabf`

### 评论模板
【ColorSingleton Windows 早退路径下部分 ANSI 颜色成员可能未初始化，应构造开头设默认值】请给出 file:line 证据；若确认问题，说明影响与修复建议。
