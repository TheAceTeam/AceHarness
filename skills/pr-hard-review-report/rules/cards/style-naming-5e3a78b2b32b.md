---
id: style-naming-5e3a78b2b32b
dimension: style
category: naming
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["Int64.Max", "maxCapacity", "字节", "未说明为何预留", "缺少注释"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 5e3a78b2b32b
---

maxCapacity 取 Int64.Max-8 缺少注释，未说明为何预留 8 字节

### 触发现象 (positive_signals)
- maxCapacity 取 Int64.Max-8 缺少注释，未说明为何预留 8 字节
- `maxCapacity` 定义为 `Int64

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
添加注释说明为何选择 `Int64.Max - 8` 作为最大容量，帮助后续维护者理解设计意图。

### 评论模板
【maxCapacity 取 Int64.Max-8 缺少注释，未说明为何预留 8 字节】请给出 file:line 证据；若确认问题，说明影响与修复建议。
