---
id: style-uncategorized-d013f62c1188
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["Random", "random.cj", "安全", "注释", "源码缺少对应类级", "线程警告仅在文档"]
file_globs: ["**/*.cj", "**/*.md"]
action_level: MAY
check_type: semantic
text_hash: d013f62c1188
---

Random 安全/线程警告仅在文档，random.cj 源码缺少对应类级注释

### 触发现象 (positive_signals)
- Random 安全/线程警告仅在文档，random.cj 源码缺少对应类级注释
- 安全性警告放在类文档中很好，但在 `random

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
在 `Random` 类定义前添加注释，提醒开发者此类的安全限制： ```cj /

### 评论模板
【Random 安全/线程警告仅在文档，random.cj 源码缺少对应类级注释】请给出 file:line 证据；若确认问题，说明影响与修复建议。
