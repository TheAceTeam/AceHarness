---
id: style-formatting-0506a640d9f4
dimension: style
category: formatting
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["Content-Length", "abc", "isValidContentLengthFormat", "parse", "会通过但", "只查首字符", "失败且报错不准"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: static
text_hash: 0506a640d9f4
---

isValidContentLengthFormat 只查首字符>=1，"abc"/"123abc" 会通过但 parse 失败且报错不准

### 触发现象 (positive_signals)
- isValidContentLengthFormat 只查首字符>=1，"abc"/"123abc" 会通过但 parse 失败且报错不准
- diff 中出现 `parse` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 关联规则 (related_rules)
- `style-formatting-01cb1ac25f9b`
- `style-uncategorized-a43193a05d51`
- `style-uncategorized-cefd4bbd08d2`

### 评论模板
【isValidContentLengthFormat 只查首字符>=1，"abc"/"123abc" 会通过但 parse 失败且报错不准】请给出 file:line 证据；若确认问题，说明影响与修复建议。
