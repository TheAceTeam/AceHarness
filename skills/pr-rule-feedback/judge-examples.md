# 黄军反馈示例

## 示例 1：issue 成立，多规则合并

蓝军 issues 指向同一处命名与注释问题：

```json
{
  "rule_ids": ["style-naming-c24e74ff15fe", "style-comment-0bef34cfc1dd"],
  "content": "判定：成立。变量名不符合命名规范，且缺少说明性注释。规则修改：维持两条规则的触发；若仅针对 public API，建议在规则中澄清适用范围。",
  "agent": true
}
```

---

## 示例 2：issue 不成立

蓝军报并发竞态，但代码有单线程文档 + 原子操作：

```json
{
  "rule_ids": ["function-concurrency-13fe18275149"],
  "content": "判定：不成立。该路径为原子递增且注释注明单线程调用，不构成 check-then-act 竞态。规则修改：补充 negative_guard：调用方文档已约束单线程且使用原子操作时不应报。",
  "agent": true
}
```

---

## 示例 3：部分成立

```json
{
  "rule_ids": ["function-boundary_overflow-8b1889127f2c"],
  "content": "判定：部分成立。存在边界检查遗漏，但仅影响非关键调试路径，严重级别应由「高」降为「中」。规则修改：补充 positive_signal：调试开关关闭时主路径已校验，避免对双路径代码误报为高。",
  "agent": true
}
```
