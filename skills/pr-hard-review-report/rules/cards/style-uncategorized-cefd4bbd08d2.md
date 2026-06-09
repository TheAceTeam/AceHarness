---
id: style-uncategorized-cefd4bbd08d2
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["Content-Length", "isValidContentLengthFormat", "return", "true", "外直接", "未校验纯数字格式", "除空串和"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: static
text_hash: cefd4bbd08d2
---

isValidContentLengthFormat 除空串和 "0" 外直接 return true，未校验纯数字格式

### 触发现象 (positive_signals)
- isValidContentLengthFormat 除空串和 "0" 外直接 return true，未校验纯数字格式
- 函数名为验证格式，但逻辑只检查了空字符串，未验证字符串是否为有效数字格式（如 "abc" 会返回 true）

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 关联规则 (related_rules)
- `style-formatting-01cb1ac25f9b`
- `style-formatting-0506a640d9f4`
- `style-uncategorized-a43193a05d51`

### 评论模板
【isValidContentLengthFormat 除空串和 "0" 外直接 return true，未校验纯数字格式】请给出 file:line 证据；若确认问题，说明影响与修复建议。
