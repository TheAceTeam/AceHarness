---
id: function-resource_lifecycle-03610bb8eff9
dimension: function
category: resource_lifecycle
severity: medium
always_on: true
rule_tier: hard
keyword_triggers: ["DynPopFree", "STRONG", "free", "strcmp", "其他", "函数缺少动态查找", "回退", "少数符号", "模式仅"]
file_globs: ["**/*.cj", "**/*.{c,h}"]
action_level: SHOULD
check_type: semantic
text_hash: 03610bb8eff9
---

DynPopFree 在 STRONG 模式仅 strcmp 少数符号，其他 free 函数缺少动态查找回退

### 触发现象 (positive_signals)
- DynPopFree 在 STRONG 模式仅 strcmp 少数符号，其他 free 函数缺少动态查找回退
- 在 STRONG 模式下，`DynPopFree` 函数只处理了 `GENERAL_NAME_free` 和 `X509_EXTENSION_free` 两个函数

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
- 确认 `DynPopFree` 在 STRONG 模式下的所有调用场景，验证是否只有这两个函数会被传入 - 如果有其他函数可能被传入，考虑添加编译时断言或扩展支持列表

### 评论模板
【DynPopFree 在 STRONG 模式仅 strcmp 少数符号，其他 free 函数缺少动态查找回退】请给出 file:line 证据；若确认问题，说明影响与修复建议。
