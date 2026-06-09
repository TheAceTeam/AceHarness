---
id: function-performance-b38d515cec65
dimension: function
category: performance
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["ArrayList", "Content-Length", "HttpNormalBody", "add", "toArray", "多次扩容", "最终拷贝有性能开", "逐块"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: b38d515cec65
---

HttpNormalBody 用 ArrayList 逐块 add 再 toArray，多次扩容+最终拷贝有性能开销

### 触发现象 (positive_signals)
- HttpNormalBody 用 ArrayList 逐块 add 再 toArray，多次扩容+最终拷贝有性能开销
- ArrayList 在添加数据时会多次扩容（内部数组增长和复制），最后 `toArray()` 还会分配一个完整大小的数组并复制所有元素

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
如果已知 Content-Length 且在合理范围内（例如 < 10MB），可以预分配适当大小的 ArrayList 以减少扩容开销： 或者使用 ByteArrayOutputStream 等专门设计的类（如果有）。

### 评论模板
【HttpNormalBody 用 ArrayList 逐块 add 再 toArray，多次扩容+最终拷贝有性能开销】请给出 file:line 证据；若确认问题，说明影响与修复建议。
