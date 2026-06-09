---
id: style-uncategorized-f5b29fbff363
dimension: style
category: uncategorized
severity: high
always_on: false
rule_tier: soft
keyword_triggers: ["CPointerResource.use", "TOCTOU", "UAF", "action", "isFree.load", "value", "存在", "竞态可"]
file_globs: ["**/*.cj"]
action_level: MUST
check_type: semantic
text_hash: f5b29fbff363
---

CPointerResource.use 先 isFree.load 再 action(value)，存在 TOCTOU 竞态可 UAF

### 触发现象 (positive_signals)
- CPointerResource.use 先 isFree.load 再 action(value)，存在 TOCTOU 竞态可 UAF
- `isFree

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
需要使用锁或其他同步机制确保 `use()` 和 `close()` 互斥，或者使用引用计数机制。

### 关联规则 (related_rules)
- `function-boundary_overflow-8b1889127f2c`
- `spec-api_abi_compat-7857a90a806a`
- `style-uncategorized-6826810dfc2d`

### 评论模板
【CPointerResource.use 先 isFree.load 再 action(value)，存在 TOCTOU 竞态可 UAF】请给出 file:line 证据；若确认问题，说明影响与修复建议。
