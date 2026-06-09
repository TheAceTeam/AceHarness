---
id: style-uncategorized-fd030da0fabf
dimension: style
category: uncategorized
severity: high
always_on: false
rule_tier: soft
keyword_triggers: ["ANSI", "ColorSingleton", "全保护", "单例构造无线程安", "多线程首次访问可", "能竞态导致", "颜色未初始化"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: MUST
check_type: semantic
text_hash: fd030da0fabf
---

ColorSingleton 单例构造无线程安全保护，多线程首次访问可能竞态导致 ANSI 颜色未初始化

### 触发现象 (positive_signals)
- ColorSingleton 单例构造无线程安全保护，多线程首次访问可能竞态导致 ANSI 颜色未初始化
- ColorSingleton是单例模式，但其构造函数没有线程安全保护

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
使用Meyer's单例模式或std::call_once确保线程安全初始化： 或者在构造函数中使用std::call_once：

### 关联规则 (related_rules)
- `function-resource_lifecycle-13f974d57002`

### 评论模板
【ColorSingleton 单例构造无线程安全保护，多线程首次访问可能竞态导致 ANSI 颜色未初始化】请给出 file:line 证据；若确认问题，说明影响与修复建议。
