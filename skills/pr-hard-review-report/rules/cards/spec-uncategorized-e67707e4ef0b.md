---
id: spec-uncategorized-e67707e4ef0b
dimension: spec
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["direct", "exit", "return", "shell", "source", "执行方式选择", "脚本应据", "避免误退出整个"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: e67707e4ef0b
---

shell 脚本应据 source/direct 执行方式选择 return 或 exit，避免误退出整个 shell

### 触发现象 (positive_signals)
- shell 脚本应据 source/direct 执行方式选择 return 或 exit，避免误退出整个 shell

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【shell 脚本应据 source/direct 执行方式选择 return 或 exit，避免误退出整个 shell】请给出 file:line 证据；若确认问题，说明影响与修复建议。
