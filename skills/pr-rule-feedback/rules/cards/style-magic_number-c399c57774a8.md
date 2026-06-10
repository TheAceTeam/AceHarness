---
id: style-magic_number-c399c57774a8
dimension: style
category: magic_number
severity: medium
always_on: false
rule_tier: soft
keyword_triggers: ["DEFAULT_MAX_BODY_SIZE", "constants", "不一致且分散", "体大小三处硬编码"]
file_globs: ["**/*.cj"]
action_level: SHOULD
check_type: semantic
text_hash: c399c57774a8
---

HTTP 体大小三处硬编码 10MB，与 constants DEFAULT_MAX_BODY_SIZE(2MB) 不一致且分散

### 触发现象 (positive_signals)
- HTTP 体大小三处硬编码 10MB，与 constants DEFAULT_MAX_BODY_SIZE(2MB) 不一致且分散
- 三处调用点都硬编码了 `1024 * 1024 * 10`（10MB），但 `constants

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
统一使用常量或定义新的 `DEFAULT_CHUNKED_BODY_MAX_SIZE` 常量： ```cj // 在 constants.cj 中 const DEFAULT_MAX_BODY_SIZE = 2

### 评论模板
【HTTP 体大小三处硬编码 10MB，与 constants DEFAULT_MAX_BODY_SIZE(2MB) 不一致且分散】请给出 file:line 证据；若确认问题，说明影响与修复建议。
