---
id: style-uncategorized-ee69df2c5063
dimension: style
category: uncategorized
severity: low
always_on: false
rule_tier: soft
keyword_triggers: ["CJ_JSON_ParseFloat64", "字节栈缓冲", "截断导致精度损失", "超长数字会被静默"]
file_globs: ["**/*.cj", "**/*.{c,h}"]
action_level: MAY
check_type: semantic
text_hash: ee69df2c5063
---

CJ_JSON_ParseFloat64 用 512 字节栈缓冲，超长数字会被静默截断导致精度损失

### 触发现象 (positive_signals)
- CJ_JSON_ParseFloat64 用 512 字节栈缓冲，超长数字会被静默截断导致精度损失
- 使用固定 512 字节栈缓冲区解析浮点数

### 误报边界 (negative_guards)
- 仅注释/文档/测试改动且未触及运行时逻辑时，可标为不适用
- 团队已明确接受的兼容性权衡且有 PR 说明时，可降级为建议

### 审查问题 (review_questions)
- 能否在 diff 中指出具体文件与行号证据？
- 是否存在评论中描述的例外或已修复路径？
- 该问题是否会导致编译失败、崩溃、数据错误或 silent wrong behavior？

### 修复建议 (fix_hint)
1. 添加注释说明 512 字节的合理性依据 2. 考虑在截断时记录警告日志 3. 或使用动态内存分配处理超长数字

### 评论模板
【CJ_JSON_ParseFloat64 用 512 字节栈缓冲，超长数字会被静默截断导致精度损失】请给出 file:line 证据；若确认问题，说明影响与修复建议。
