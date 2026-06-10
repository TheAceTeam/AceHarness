---
id: function-security_input-fc7cb92884c6
dimension: function
category: security_input
severity: high
always_on: true
rule_tier: hard
keyword_triggers: ["Interpreter", "initialized", "interpreter_interface", "nullptr", "多线程可能竞态使", "用未初始化", "非原子"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: MUST
check_type: semantic
text_hash: fc7cb92884c6
---

Interpreter initialized 非原子，多线程可能竞态使用未初始化 interpreter_interface

### 触发现象 (positive_signals)
- Interpreter initialized 非原子，多线程可能竞态使用未初始化 interpreter_interface
- `initialized` 标志不是原子变量，多线程环境下可能存在竞态条件

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
使用 `std::atomic<bool>` 或 `std::once_flag` 确保线程安全的初始化。

### 评论模板
【Interpreter initialized 非原子，多线程可能竞态使用未初始化 interpreter_interface】请给出 file:line 证据；若确认问题，说明影响与修复建议。
