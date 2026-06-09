---
id: style-uncategorized-1aab327ab818
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["GetStdHandle", "INVALID_HANDLE_VALUE", "hStderr", "hStdout", "nullptr", "失败返回", "检查冗余且", "用法不正确", "而非"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: 1aab327ab818
---

GetStdHandle 失败返回 INVALID_HANDLE_VALUE 而非 nullptr，对 hStdout/hStderr 的 nullptr 检查冗余且 API 用法不正确

### 触发现象 (positive_signals)
- GetStdHandle 失败返回 INVALID_HANDLE_VALUE 而非 nullptr，对 hStdout/hStderr 的 nullptr 检查冗余且 API 用法不正确
- 代码检查hStdout和hStderr是否为nullptr，但GetStdHandle()在错误时返回INVALID_HANDLE_VALUE而非nullptr
- diff 中出现 `GetStdHandle` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
删除不必要的nullptr检查：

### 评论模板
【GetStdHandle 失败返回 INVALID_HANDLE_VALUE 而非 nullptr，对 hStdout/hStderr 的 nullptr 检查冗余且 API 用法不正确】请给出 file:line 证据；若确认问题，说明影响与修复建议。
