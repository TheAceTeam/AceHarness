---
id: style-uncategorized-c546dd3718fa
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["File.create", "exists", "文件上传移除", "时的抛错", "检查改", "覆盖行为", "需确认文件已存在"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: c546dd3718fa
---

文件上传移除 exists 检查改 File.create，需确认文件已存在时的抛错/覆盖行为

### 触发现象 (positive_signals)
- 文件上传移除 exists 检查改 File.create，需确认文件已存在时的抛错/覆盖行为
- 移除了文件存在性检查，改为依赖 `File

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认 `File.create()` 的文档说明，确保不会意外覆盖已存在的文件。

### 评论模板
【文件上传移除 exists 检查改 File.create，需确认文件已存在时的抛错/覆盖行为】请给出 file:line 证据；若确认问题，说明影响与修复建议。
