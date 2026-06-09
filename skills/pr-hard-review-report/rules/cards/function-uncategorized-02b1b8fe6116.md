---
id: function-uncategorized-02b1b8fe6116
dimension: function
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["OpenSSL", "SSL", "Windows", "仅检查", "动态加载缺", "库版本校验", "版本不足"]
file_globs: ["**/*.cj", "**/*.{c,h}"]
action_level: MAY
check_type: semantic
text_hash: 02b1b8fe6116
---

Windows OpenSSL 动态加载缺 SSL 库版本校验，仅检查 OS 版本不足

### 触发现象 (positive_signals)
- Windows OpenSSL 动态加载缺 SSL 库版本校验，仅检查 OS 版本不足
- 在 Windows 的 EnsureLoadedOnceCallback 中，对 g_singletonHandleSsl 单独验证版本仅在 g_singletonHandle == NULL 时执行
- diff 中出现 `GetConfiguredOpenSslPaths` 或同类变更

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
考虑对两个库都独立验证版本（当前逻辑已足够安全，仅作建议）。

### 评论模板
【Windows OpenSSL 动态加载缺 SSL 库版本校验，仅检查 OS 版本不足】请给出 file:line 证据；若确认问题，说明影响与修复建议。
