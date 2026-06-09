---
id: function-compiler_internal-4240cf1f14dc
dimension: function
category: compiler_internal
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["JsonParserPool.acquire", "cache", "mutex", "parser", "synchronized", "不清理", "不足时仍保留池中", "可能导致资源滞留"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 4240cf1f14dc
---

JsonParserPool.acquire 在 cache 不足时仍保留池中 parser 不清理，可能导致资源滞留

### 触发现象 (positive_signals)
- JsonParserPool.acquire 在 cache 不足时仍保留池中 parser 不清理，可能导致资源滞留
- 当池中的 parser 缓存不满足需求时，直接创建新 parser 而不清理池中不满足条件的 parser
- diff 中出现 `parser` 或同类变更
- diff 中出现 `parser.cache.size` 或同类变更
- diff 中出现 `parser.reinit` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
1. 考虑从池中移除不满足条件的 parser 并释放资源 2. 或添加池大小限制和清理策略

### 评论模板
【JsonParserPool.acquire 在 cache 不足时仍保留池中 parser 不清理，可能导致资源滞留】请给出 file:line 证据；若确认问题，说明影响与修复建议。
