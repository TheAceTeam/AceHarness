---
id: style-formatting-01cb1ac25f9b
dimension: style
category: formatting
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["Content", "Content-Length", "Length", "前导零校验", "同时拒绝非数字开", "头字符串", "建议在注释中明确", "设计意图"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 01cb1ac25f9b
---

Content-Length 前导零校验 s[0]<b'1' 同时拒绝非数字开头字符串，建议在注释中明确设计意图

### 触发现象 (positive_signals)
- Content-Length 前导零校验 s[0]<b'1' 同时拒绝非数字开头字符串，建议在注释中明确设计意图
- 当前实现检查 `s[0] < b'1'` 来禁止前导零，但这个条件也会拒绝空字符串以外的所有以非数字字符开头的情况

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
当前的实现实际上是正确的，因为 Content-Length 应该是非负整数。建议在代码注释中明确说明这一点，以便后续维护者理解设计意图。

### 关联规则 (related_rules)
- `style-formatting-0506a640d9f4`
- `style-uncategorized-a43193a05d51`
- `style-uncategorized-cefd4bbd08d2`

### 评论模板
【Content-Length 前导零校验 s[0]<b'1' 同时拒绝非数字开头字符串，建议在注释中明确设计意图】请给出 file:line 证据；若确认问题，说明影响与修复建议。
