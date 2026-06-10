---
id: style-uncategorized-e82770f393ad
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["AI_ALL", "AI_PASSIVE", "dns.cj", "hints.ai_flags", "可能改变解析", "移除", "绑定地址类型行为"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: e82770f393ad
---

dns.cj 移除 hints.ai_flags=AI_PASSIVE|AI_ALL，可能改变解析/绑定地址类型行为

### 触发现象 (positive_signals)
- dns.cj 移除 hints.ai_flags=AI_PASSIVE|AI_ALL，可能改变解析/绑定地址类型行为
- 移除了 `hints

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认移除 flags 的意图。如果是为了修复 Windows 兼容性问题,建议保留 flags 设置但仅移除不兼容的部分;如果 flags 设置本身就是 bug,请在 Issue/PR 描述中说明。

### 评论模板
【dns.cj 移除 hints.ai_flags=AI_PASSIVE|AI_ALL，可能改变解析/绑定地址类型行为】请给出 file:line 证据；若确认问题，说明影响与修复建议。
