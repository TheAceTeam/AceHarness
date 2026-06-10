---
id: function-exception_error-ca2be0ebd46f
dimension: function
category: exception_error
severity: high
always_on: false
rule_tier: hard
keyword_triggers: ["cjpm_openssl_strong.toml", "link", "stdx", "tmp", "影响可移植构建", "硬编码", "等临时", "路径"]
file_globs: ["**/*.cj", "**/*.toml"]
action_level: MUST
check_type: static
text_hash: ca2be0ebd46f
---

cjpm_openssl_strong.toml 硬编码 /tmp/stdx 等临时 link 路径，影响可移植构建

### 触发现象 (positive_signals)
- cjpm_openssl_strong.toml 硬编码 /tmp/stdx 等临时 link 路径，影响可移植构建
- 在 macOS target 配置中硬编码了 `/tmp/stdx/target/release/stdx` 路径，这是一个临时目录路径，在其他开发者的机器上很可能不存在，会导致链接失败

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
- 移除 `/tmp/stdx/target/release/stdx` 路径 - 如果是开发调试遗留的路径，应该在提交前清理

### 评论模板
【cjpm_openssl_strong.toml 硬编码 /tmp/stdx 等临时 link 路径，影响可移植构建】请给出 file:line 证据；若确认问题，说明影响与修复建议。
