---
id: style-comment-d348e2fbf996
dimension: style
category: comment
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["createExportHandle", "init", "lazy", "synchronized", "validateHandle", "多线程可能重复", "新增", "注释矛盾", "非并发安全"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: d348e2fbf996
---

validateHandle 新增 lazy init 与「非并发安全」注释矛盾，多线程可能重复 createExportHandle

### 触发现象 (positive_signals)
- validateHandle 新增 lazy init 与「非并发安全」注释矛盾，多线程可能重复 createExportHandle
- 虽然添加了注释说明 `validateHandle()` 不是并发安全的，但新增的条件检查 `if (handle == invalidHandle)` 在多线程环境下仍可能存在竞态条件： - 线程 A 检查 `handle == invalidHandle` 为 true - 线程 B 同时检查 `handle == invalidHandle` 为 true - 两个线程都进入 `createExportHandle` 调用，导致重复创建

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
如果确实需要在多线程环境下安全使用，可以考虑： 1. 使用 `synchronized` 保护 `validateHandle()` 方法 2. 或者在注释中明确说明必须在单线程初始化阶段调用，并考虑添加运行时检查

### 评论模板
【validateHandle 新增 lazy init 与「非并发安全」注释矛盾，多线程可能重复 createExportHandle】请给出 file:line 证据；若确认问题，说明影响与修复建议。
