---
id: function-exception_error-028dfaa2e18b
dimension: function
category: exception_error
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["CMakeLists", "cangjie", "dev", "include", "可发现路径", "应改用环境变量或", "硬编码"]
file_globs: ["**/*.cj", "**/CMakeLists.txt"]
action_level: SHOULD
check_type: static
text_hash: 028dfaa2e18b
---

CMakeLists 硬编码 ~/dev/cangjie/include，应改用环境变量或可发现路径

### 触发现象 (positive_signals)
- CMakeLists 硬编码 ~/dev/cangjie/include，应改用环境变量或可发现路径
- 硬编码了开发者路径 `~/dev/cangjie/cangjie/include`,这个路径在其他开发者的机器上很可能不存在,降低了构建系统的可移植性

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
使用更健壮的路径查找机制,例如:

### 评论模板
【CMakeLists 硬编码 ~/dev/cangjie/include，应改用环境变量或可发现路径】请给出 file:line 证据；若确认问题，说明影响与修复建议。
