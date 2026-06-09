---
id: style-uncategorized-9044faf3e0b7
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["get", "isIdempotentMethod", "method", "为幂等方法", "大小写敏感", "影响自动重试", "等小写不会被识别"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 9044faf3e0b7
---

isIdempotentMethod 大小写敏感：method("get") 等小写不会被识别为幂等方法，影响自动重试

### 触发现象 (positive_signals)
- isIdempotentMethod 大小写敏感：method("get") 等小写不会被识别为幂等方法，影响自动重试
- 如果用户设置 `method("get")`（小写），不会被识别为幂等方法，可能导致： - 应该重试的 GET 请求不会自动重试

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
使用大小写不敏感的比较，或将方法名统一转为大写。

### 关联规则 (related_rules)
- `function-uncategorized-39fefcc7e6a9`
- `function-uncategorized-eb65d4062e24`

### 评论模板
【isIdempotentMethod 大小写敏感：method("get") 等小写不会被识别为幂等方法，影响自动重试】请给出 file:line 证据；若确认问题，说明影响与修复建议。
