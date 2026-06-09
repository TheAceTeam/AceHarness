---
id: style-uncategorized-2050d1498a29
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["AddIndirectExtend", "TypeMatchingImpl", "unordered_map", "临时映射未见析构", "多个", "有泄漏风险", "清理"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: 2050d1498a29
---

AddIndirectExtend TypeMatchingImpl 多个 unordered_map 临时映射未见析构清理，有泄漏风险

### 触发现象 (positive_signals)
- AddIndirectExtend TypeMatchingImpl 多个 unordered_map 临时映射未见析构清理，有泄漏风险
- 多个 unordered_map 存储临时类型映射，未见析构函数清理逻辑

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
添加析构函数清理临时映射。

### 评论模板
【AddIndirectExtend TypeMatchingImpl 多个 unordered_map 临时映射未见析构清理，有泄漏风险】请给出 file:line 证据；若确认问题，说明影响与修复建议。
