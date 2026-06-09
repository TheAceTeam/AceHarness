---
id: function-performance-cece5b61e9a9
dimension: function
category: performance
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["Exception", "cause", "允许任意", "印栈时无限递归", "循环引用可导致打"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: cece5b61e9a9
---

Exception 允许任意 cause 链，A→B→A 循环引用可导致打印栈时无限递归

### 触发现象 (positive_signals)
- Exception 允许任意 cause 链，A→B→A 循环引用可导致打印栈时无限递归
- 当前实现允许传入任意 Exception 作为 cause，可能存在循环引用的风险（A caused by B, B caused by A），导致在打印异常链时出现无限递归

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
- 在设置 `innerCause` 前检查是否形成循环引用 - 添加深度限制，防止过深的异常链导致栈溢出

### 评论模板
【Exception 允许任意 cause 链，A→B→A 循环引用可导致打印栈时无限递归】请给出 file:line 证据；若确认问题，说明影响与修复建议。
