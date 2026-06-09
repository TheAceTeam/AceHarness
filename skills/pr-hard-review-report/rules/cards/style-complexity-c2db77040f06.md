---
id: style-complexity-c2db77040f06
dimension: style
category: complexity
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["ActorMacro.cd", "ReceiverModification.fd", "let", "match", "refactor", "var", "zeroValue", "不一致"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: c2db77040f06
---

ActorMacro.cd 已 refactor 为 let+match，ReceiverModification.fd 仍 var+zeroValue 不一致

### 触发现象 (positive_signals)
- ActorMacro.cd 已 refactor 为 let+match，ReceiverModification.fd 仍 var+zeroValue 不一致
- 在本次重构中，`ActorMacro` 类的 `cd` 字段已改为 `let` 并使用 match 表达式初始化，但 `ReceiverModification` 类的 `fd` 字段仍保持 `var` 并使用 `unsafe { zeroValue<FuncDecl>() }` 初始化
- diff 中出现 `parseDecl` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
统一重构风格，将 `fd` 也改为 `let` 并使用 match 表达式初始化： 或在构造函数中直接初始化：

### 评论模板
【ActorMacro.cd 已 refactor 为 let+match，ReceiverModification.fd 仍 var+zeroValue 不一致】请给出 file:line 证据；若确认问题，说明影响与修复建议。
