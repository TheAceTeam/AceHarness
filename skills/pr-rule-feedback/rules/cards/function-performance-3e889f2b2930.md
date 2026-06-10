---
id: function-performance-3e889f2b2930
dimension: function
category: performance
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["cjo", "兼容策略变更", "可能导致运行错误", "文档说明", "混用旧版", "编译器产物二进制", "需在"]
file_globs: []
action_level: SHOULD
check_type: semantic
text_hash: 3e889f2b2930
---

编译器产物二进制兼容策略变更，混用旧版 cjo 可能导致运行错误，需在 PR/文档说明

### 触发现象 (positive_signals)
- 编译器产物二进制兼容策略变更，混用旧版 cjo 可能导致运行错误，需在 PR/文档说明

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 评论模板
【编译器产物二进制兼容策略变更，混用旧版 cjo 可能导致运行错误，需在 PR/文档说明】请给出 file:line 证据；若确认问题，说明影响与修复建议。
