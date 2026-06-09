---
id: function-logic_correctness-f13ac96b1ab5
dimension: function
category: logic_correctness
severity: medium
always_on: false
rule_tier: hard
keyword_triggers: ["IntroduceParameter", "UpdateCallSites", "会导致调用点编译", "失败", "对含局部变量引用", "的选中项改签名但"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: f13ac96b1ab5
---

IntroduceParameter 对含局部变量引用的选中项改签名但不 UpdateCallSites，会导致调用点编译失败

### 触发现象 (positive_signals)
- IntroduceParameter 对含局部变量引用的选中项改签名但不 UpdateCallSites，会导致调用点编译失败

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【IntroduceParameter 对含局部变量引用的选中项改签名但不 UpdateCallSites，会导致调用点编译失败】请给出 file:line 证据；若确认问题，说明影响与修复建议。
