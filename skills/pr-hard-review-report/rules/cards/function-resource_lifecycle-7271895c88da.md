---
id: function-resource_lifecycle-7271895c88da
dimension: function
category: resource_lifecycle
severity: high
always_on: true
rule_tier: hard
keyword_triggers: ["UAF", "thread.state", "加压力测试", "曾存在", "需确认修复完整并"]
file_globs: ["**/*.cj"]
action_level: MUST
check_type: semantic
text_hash: 7271895c88da
---

thread.state 曾存在 UAF，需确认修复完整并加压力测试

### 触发现象 (positive_signals)
- thread.state 曾存在 UAF，需确认修复完整并加压力测试

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认修复方案彻底，添加压力测试验证

### 评论模板
【thread.state 曾存在 UAF，需确认修复完整并加压力测试】请给出 file:line 证据；若确认问题，说明影响与修复建议。
