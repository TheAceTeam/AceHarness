---
id: style-uncategorized-bcf6249094fd
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["char", "interpreted_frame_info_t", "字段生命周期", "文档说明", "释放责任未在"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: bcf6249094fd
---

interpreted_frame_info_t 中 char* 字段生命周期/释放责任未在 API 文档说明

### 触发现象 (positive_signals)
- interpreted_frame_info_t 中 char* 字段生命周期/释放责任未在 API 文档说明
- 字符串指针的生命周期未明确说明

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
在文档中明确字符串生命周期，或使用 `const char*` 表示只读。

### 评论模板
【interpreted_frame_info_t 中 char* 字段生命周期/释放责任未在 API 文档说明】请给出 file:line 证据；若确认问题，说明影响与修复建议。
