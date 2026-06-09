---
id: style-uncategorized-bfb4a3a6dfcd
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["Semaphore", "cnt.fetchSub", "synchronized", "与实际信号不匹配", "块外执行", "高并发下计数可能"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: bfb4a3a6dfcd
---

Semaphore cnt.fetchSub(1) 在 synchronized 块外执行，高并发下计数可能与实际信号不匹配

### 触发现象 (positive_signals)
- Semaphore cnt.fetchSub(1) 在 synchronized 块外执行，高并发下计数可能与实际信号不匹配
- `cnt
- diff 中出现 `cnt.fetchAdd` 或同类变更
- diff 中出现 `cnt.fetchSub` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
将计数递减操作移入 synchronized 块内，确保原子性：

### 关联规则 (related_rules)
- `style-uncategorized-12552b6de041`
- `style-uncategorized-6d987850e488`

### 评论模板
【Semaphore cnt.fetchSub(1) 在 synchronized 块外执行，高并发下计数可能与实际信号不匹配】请给出 file:line 证据；若确认问题，说明影响与修复建议。
