# 功能开发工作流示例

这是一个典型的三阶段功能开发工作流：设计 → 实现 → 测试 → 完成。

## 状态流转图

```
设计（isInitial）──pass──> 实现 ──pass──> 测试 ──pass──> 完成（isFinal）
  │                        │                │
  │──cond_pass──> 实现     │──cond_pass──> 测试    │──cond_pass──> 完成
  │                        │                │
  └──fail──> 设计          └──fail──> 设计   └──fail──> 实现
```

## 设计决策

- **设计阶段** fail 回到自身（重新设计）
- **实现阶段** fail 回到设计（可能是设计有问题）
- **测试阶段** fail 回到实现（代码需要修复）
- 每个阶段使用红蓝对抗模式：defender 做事，attacker 找问题，judge 裁决

## 完整输出

<result>
{"kind":"workflow_draft","payload":{"filename":"feature-dev.yaml","summary":"三阶段功能开发工作流：设计-实现-测试","config":{"workflow":{"states":[{"name":"设计","isInitial":true,"steps":[{"name":"编写设计方案","agent":"defender","prompt":"根据需求编写技术设计方案，包括架构选型、接口设计、数据模型"},{"name":"审查设计","agent":"attacker","prompt":"审查设计方案，找出潜在问题：扩展性、性能、安全性、边界情况"},{"name":"设计裁决","agent":"judge","prompt":"综合评判设计方案质量，决定是否可以进入实现阶段"}],"transitions":[{"to":"实现","condition":{"verdict":"pass"}},{"to":"实现","condition":{"verdict":"conditional_pass"}},{"to":"设计","condition":{"verdict":"fail"}}]},{"name":"实现","steps":[{"name":"编写代码","agent":"defender","prompt":"按照设计方案实现功能代码，包括单元测试"},{"name":"代码审查","agent":"attacker","prompt":"审查代码实现：逻辑正确性、代码规范、测试覆盖率、安全漏洞"},{"name":"实现裁决","agent":"judge","prompt":"综合评判代码实现质量，决定是否可以进入测试阶段"}],"transitions":[{"to":"测试","condition":{"verdict":"pass"}},{"to":"测试","condition":{"verdict":"conditional_pass"}},{"to":"设计","condition":{"verdict":"fail"}}]},{"name":"测试","steps":[{"name":"执行测试","agent":"defender","prompt":"执行集成测试和端到端测试，验证功能完整性"},{"name":"测试审查","agent":"attacker","prompt":"检查测试覆盖率，尝试找到未覆盖的边界情况和异常路径"},{"name":"测试裁决","agent":"judge","prompt":"综合评判测试结果，决定功能是否达到上线标准"}],"transitions":[{"to":"完成","condition":{"verdict":"pass"}},{"to":"完成","condition":{"verdict":"conditional_pass"}},{"to":"实现","condition":{"verdict":"fail"}}]},{"name":"完成","isFinal":true,"steps":[],"transitions":[]}]},"context":{"projectRoot":"/Users/example/my-feature","workspaceMode":"in-place"}}}}
</result>

## 字段名提醒

| 正确 | 错误 | 说明 |
|------|------|------|
| `isInitial` | `initial` | 初始状态标记 |
| `isFinal` | `final` | 终止状态标记 |
| `to` | `target` | 转移目标 |
| `verdict` | `result` | 判定类型 |
