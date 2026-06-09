---
id: function-boundary_overflow-12952a94e41b
dimension: function
category: boundary_overflow
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["OpenSSL", "PEM", "keys.c", "len", "memcpy", "含终止符但返回", "密码回调", "边界与缓冲区写入", "需确认"]
file_globs: ["**/*.cj", "**/*.{c,h}"]
action_level: MAY
check_type: semantic
text_hash: 12952a94e41b
---

keys.c PEM 密码回调 memcpy 含终止符但返回 len-1，需确认 OpenSSL 边界与缓冲区写入

### 触发现象 (positive_signals)
- keys.c PEM 密码回调 memcpy 含终止符但返回 len-1，需确认 OpenSSL 边界与缓冲区写入
- 修改前返回 `(int)len`（包含终止符），修改后返回 `(int)len - 1`（不含终止符）

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
验证 OpenSSL 的 `PEM_password_cb` 回调规范，确认是否应包含终止符。考虑只复制 `len - 1` 字节（不含终止符），或确认当前行为在不同 OpenSSL 版本下的兼容性。

### 评论模板
【keys.c PEM 密码回调 memcpy 含终止符但返回 len-1，需确认 OpenSSL 边界与缓冲区写入】请给出 file:line 证据；若确认问题，说明影响与修复建议。
