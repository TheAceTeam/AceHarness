---
id: function-resource_lifecycle-5864e5a96d4a
dimension: function
category: resource_lifecycle
severity: low
always_on: true
rule_tier: hard
keyword_triggers: ["ArrayList", "GCM", "OOM", "SM4", "tag", "的权衡", "级文件有", "缓存全量明文", "解密用", "需先验", "风险"]
file_globs: ["**/*.cj"]
action_level: MAY
check_type: semantic
text_hash: 5864e5a96d4a
---

SM4 解密用 ArrayList 缓存全量明文，GB 级文件有 OOM 风险（GCM 需先验 tag 的权衡）

### 触发现象 (positive_signals)
- SM4 解密用 ArrayList 缓存全量明文，GB 级文件有 OOM 风险（GCM 需先验 tag 的权衡）
- 使用 ArrayList 缓存所有解密数据，对于大文件（如 GB 级别）可能导致内存溢出

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
这是正确的安全修复（必须先验证 tag 再输出）。对于大文件场景，可考虑： 1. 添加文档说明内存使用限制 2. 或实现分块验证方案（但 GCM 标准不支持）

### 评论模板
【SM4 解密用 ArrayList 缓存全量明文，GB 级文件有 OOM 风险（GCM 需先验 tag 的权衡）】请给出 file:line 证据；若确认问题，说明影响与修复建议。
