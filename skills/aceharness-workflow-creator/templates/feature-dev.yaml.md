# 功能开发工作流示例

这是一个典型的四状态功能开发工作流：设计 → 实现 → 测试 → 完成。

## 状态流转图

```
设计（isInitial）──pass──> 实现 ──pass──> 测试 ──pass──> 完成（isFinal）
  │                        │                │
  │──cond_pass──> 设计     │──cond_pass──> 实现    │──cond_pass──> 测试
  │                        │                │
  └──fail──> 设计          └──fail──> 设计   └──fail──> 实现
```

## 设计决策

- **设计状态** fail 回到自身（重新设计）
- **实现状态** fail 回到设计（可能是设计有问题）
- **测试状态** fail 回到实现（代码需要修复）
- 每个非终止状态默认使用红蓝裁决模式：蓝方/defender 做事，红方/attacker 找问题，judge 裁决
- judge 是状态出口；transitions 读取当前状态 judge 的 `verdict`
- `conditional_pass` 表示当前状态还需继续迭代，默认回到当前状态，不直接前进

## 编排参考

- 设计状态：defender 编写方案，attacker 审查扩展性、性能、安全和边界，judge 裁决是否进入实现。
- 实现状态：developer 完成代码或配置变更，reviewer 审查实现质量，judge 判断是否进入测试。
- 测试状态：tester 或 developer 运行检查并记录证据，judge 判断是否完成。
- 完成状态：汇总交付结果、验证证据和剩余风险。

## 字段名提醒

| 正确 | 错误 | 说明 |
|------|------|------|
| `isInitial` | `initial` | 初始状态标记 |
| `isFinal` | `final` | 终止状态标记 |
| `to` | `target` | 转移目标 |
| `verdict` | `result` | 判定类型 |
