---
id: function-logic_correctness-815bea14ae27
dimension: function
category: logic_correctness
severity: low
always_on: false
rule_tier: hard
keyword_triggers: ["count", "libc.malloc", "malloc", "null", "依赖旧行为的调用", "改返回", "替代", "点需回归"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 815bea14ae27
---

libc.malloc(count=0) 改返回 null 替代 UB，依赖旧行为的调用点需回归

### 触发现象 (positive_signals)
- libc.malloc(count=0) 改返回 null 替代 UB，依赖旧行为的调用点需回归
- 零计数 malloc 现在返回 null 而非未定义行为，依赖此行为的代码可能失效
- diff 中出现 `libc.malloc` 或同类变更
- diff 中出现 `malloc` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
添加单元测试验证边界情况，检查调用点是否有零计数保护

### 评论模板
【libc.malloc(count=0) 改返回 null 替代 UB，依赖旧行为的调用点需回归】请给出 file:line 证据；若确认问题，说明影响与修复建议。
