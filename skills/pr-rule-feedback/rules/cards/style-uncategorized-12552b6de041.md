---
id: style-uncategorized-12552b6de041
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["Semaphore", "priority_queue", "queuePool", "synchronized", "同步", "并发下索引选择可", "查非空队列无整体", "能过时", "遍历"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 12552b6de041
---

priority_queue 遍历 queuePool 查非空队列无整体同步，并发下索引选择可能过时

### 触发现象 (positive_signals)
- priority_queue 遍历 queuePool 查非空队列无整体同步，并发下索引选择可能过时
- 在并发环境下，遍历 `queuePool` 查找非空队列时缺乏同步保护

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
考虑到这是单消费者场景，当前问题影响较小。但如果需要更严格的一致性，可以在 `semaphore.wait()` 成功后，使用 synchronized 或其他机制保护遍历过程。或者，重新设计优先级队列的实现，使用更高效的并发优先级队列算法。

### 关联规则 (related_rules)
- `style-uncategorized-6d987850e488`
- `style-uncategorized-bfb4a3a6dfcd`

### 评论模板
【priority_queue 遍历 queuePool 查非空队列无整体同步，并发下索引选择可能过时】请给出 file:line 证据；若确认问题，说明影响与修复建议。
