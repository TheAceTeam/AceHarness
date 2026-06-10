---
id: style-uncategorized-ab7d7ec5b28b
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["COUNT", "Timer", "getScheduler", "是否可能为负", "需确认"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: ab7d7ec5b28b
---

getScheduler 对 id<0 用 (0-id)%COUNT，需确认 Timer ID 是否可能为负

### 触发现象 (positive_signals)
- getScheduler 对 id<0 用 (0-id)%COUNT，需确认 Timer ID 是否可能为负
- 当 `id` 为负数时，使用 `(0 - id)` 进行取模
- diff 中出现 `INSTANCE_ID.fetchAdd` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
确认 Timer ID 的生成逻辑，如果确实只产生正数，可以简化为单一分支；如果存在负数 ID 场景（如用户自定义 ID），则需要保留此逻辑。

### 评论模板
【getScheduler 对 id<0 用 (0-id)%COUNT，需确认 Timer ID 是否可能为负】请给出 file:line 证据；若确认问题，说明影响与修复建议。
