---
id: style-uncategorized-6d987850e488
dimension: style
category: uncategorized
severity: high
always_on: false
rule_tier: soft
keyword_triggers: ["Semaphore", "newValue", "notify", "release", "唤醒线程数与释放", "次数", "许可数可能不匹配"]
file_globs: ["**/*.cj"]
action_level: MUST
check_type: semantic
text_hash: 6d987850e488
---

Semaphore release 用 newValue 作 notify 次数，唤醒线程数与释放许可数可能不匹配

### 触发现象 (positive_signals)
- Semaphore release 用 newValue 作 notify 次数，唤醒线程数与释放许可数可能不匹配
- 修改使用 `newValue` 作为 notify 次数，但这会导致唤醒线程数与释放许可数不匹配
- diff 中出现 `monitor.notify` 或同类变更
- diff 中出现 `notify` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
notify 次数应该是 `amount`（本次释放的许可数），而非 `newValue`（释放后的总许可数）：

### 关联规则 (related_rules)
- `style-uncategorized-12552b6de041`
- `style-uncategorized-bfb4a3a6dfcd`

### 评论模板
【Semaphore release 用 newValue 作 notify 次数，唤醒线程数与释放许可数可能不匹配】请给出 file:line 证据；若确认问题，说明影响与修复建议。
