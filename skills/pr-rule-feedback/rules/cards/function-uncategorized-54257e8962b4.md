---
id: function-uncategorized-54257e8962b4
dimension: function
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["ChildProcess", "async", "fork", "opendir", "readdir", "safe", "signal", "子进程", "等未必"]
file_globs: ["**/*.cj", "**/*.{c,h}"]
action_level: MAY
check_type: semantic
text_hash: 54257e8962b4
---

fork 子进程 ChildProcess 中 opendir/readdir 等未必 async-signal-safe

### 触发现象 (positive_signals)
- fork 子进程 ChildProcess 中 opendir/readdir 等未必 async-signal-safe
- ChildProcess 函数在 fork 后执行，必须使用 async-signal-safe 函数

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
1. 当前实现通过 `/proc/self/fd` 遍历是常见做法，虽然非严格 async-signal-safe，但在实践中问题较少 2. 回退方案使用 `sysconf(_SC_OPEN_MAX)` 和 `close()` 更安全 3. 如果需要严格符合 POSIX，可以考虑直接使用回退方案

### 评论模板
【fork 子进程 ChildProcess 中 opendir/readdir 等未必 async-signal-safe】请给出 file:line 证据；若确认问题，说明影响与修复建议。
