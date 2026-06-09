---
id: style-uncategorized-193c6b18f3ba
dimension: style
category: uncategorized
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["ArrayAllocate", "ObjectAllocate", "nullptr", "公开", "校验", "空指针检查不一致", "等缺少输入参数"]
file_globs: ["**/*.cpp", "**/*.h"]
action_level: SHOULD
check_type: semantic
text_hash: 193c6b18f3ba
---

公开 API 空指针检查不一致：ObjectAllocate/ArrayAllocate 等缺少输入参数 nullptr 校验

### 触发现象 (positive_signals)
- 公开 API 空指针检查不一致：ObjectAllocate/ArrayAllocate 等缺少输入参数 nullptr 校验
- 部分函数有空指针检查，但其他函数（如 ObjectAllocate、ArrayAllocate）没有检查输入参数

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
统一添加输入参数验证，确保所有公开 API 都有空指针检查。

### 评论模板
【公开 API 空指针检查不一致：ObjectAllocate/ArrayAllocate 等缺少输入参数 nullptr 校验】请给出 file:line 证据；若确认问题，说明影响与修复建议。
