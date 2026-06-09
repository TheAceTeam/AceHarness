---
id: style-uncategorized-e132aa328d0f
dimension: style
category: uncategorized
severity: high
always_on: false
rule_tier: soft
keyword_triggers: ["NaN", "base", "logBase", "但可能仍未覆盖", "声称修复", "等边界", "绕过校验"]
file_globs: ["**/*.cj"]
action_level: MUST
check_type: semantic
text_hash: e132aa328d0f
---

logBase 声称修复 NaN 绕过校验，但可能仍未覆盖 base 为 NaN 等边界

### 触发现象 (positive_signals)
- logBase 声称修复 NaN 绕过校验，但可能仍未覆盖 base 为 NaN 等边界
- commit message 说明修复"medium-02 logbase nan bypasses verification"，但修改

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
添加显式 NaN 检查： 此问题同样存在于 Float64 和 Float16 版本的 logBase 函数（行号约 122、148）。

### 评论模板
【logBase 声称修复 NaN 绕过校验，但可能仍未覆盖 base 为 NaN 等边界】请给出 file:line 证据；若确认问题，说明影响与修复建议。
