# 工作流配置示例

本目录包含各种类型的工作流配置示例，展示了 ACEHarness 工作流引擎的最佳实践。

## 示例列表

### 1. Supervisor 状态机工作流

**文件**: `example-supervisor-ohos-migration.yaml`

**描述**: 使用 Supervisor 智能路由的 OpenHarmony ArkTS API 仓颉移植工作流

**特点**:
- 状态机模式 (state-machine)
- 支持人工审批 (requireHumanApproval)
- 多角色协作 (defender/attacker/judge)
- 支持状态回退
- 集成编译验证和红军审查

**适用场景**: 复杂的多阶段开发任务，需要严格的质量控制和审批流程

---

### 2. 编译器 ICE 修复工作流

**文件**: `example-compiler-ice-fix.yaml`

**描述**: 修复仓颉编译器内部错误（ICE）的完整流程

**特点**:
- 状态机模式
- 包含复现、根因分析、修复实现、回归验证
- 红蓝对抗模式 (defender vs attacker)
- 多轮验证和压力测试

**适用场景**: 编译器 bug 修复、复杂技术问题的系统化解决

---

### 3. 管道运算符重载 ICE 修复

**文件**: `example-pipe-overload-ice-fix.yaml`

**描述**: 修复管道运算符 |> 配合尾随 lambda 调用重载函数时的 ICE（实际项目案例）

**特点**:
- 状态机模式
- 完整的 ICE 修复流程（复现-根因-修复-验证）
- 最小侵入性修复原则
- 包含 LLT 测试用例补充

**适用场景**: 编译器语法特性相关的 bug 修复

---

### 4. 鸿蒙应用功能开发

**文件**: `example-harmonyos-app-feature.yaml`

**描述**: 鸿蒙应用功能开发的红蓝对抗流程

**特点**:
- 状态机模式
- 设计-实施-构建-完成的完整流程
- 红蓝对抗确保代码质量
- 支持终止状态

**适用场景**: 应用功能开发、UI 组件开发

## 工作流模式

### 轻量工作流

**特点**:
- 围绕一个完整目标执行
- 由任务清单动态拆分、调度与验收
- 使用工作流级能力配置，并由执行 Agent 推进任务

**适用场景**:
- 目标、交付物和验收标准已经明确的协作任务
- 需要任务清单持续跟踪执行进展的工作

轻量工作流在配置文件中使用 `workflow.profile: lightweight` 标识；底层仍采用统一的 `state-machine` 配置结构，包含一个初始且终止的执行状态。

### State Machine (状态机模式)

**优点**:
- 明确的状态转换逻辑
- 支持条件分支和回退
- 适合复杂的决策流程
- 可视化状态图

**适用场景**:
- 需要根据结果动态决定下一步的任务
- 需要支持回退和重试的流程
- 多分支决策场景

## 最佳实践

1. **角色分配**: 合理使用 defender/attacker/judge 角色，确保代码质量
2. **人工审批**: 在关键节点设置 `requireHumanApproval: true`
3. **技能配置**: 轻量工作流通过工作流级能力执行，内部任务清单 Skill 由系统维护；状态机工作流可使用工作流通用 Skills、Agent Skills 和步骤级 Skills。
4. **超时设置**: 根据任务复杂度设置合理的 `timeoutMinutes`
5. **状态转换**: 明确定义转换条件 (verdict: pass/conditional_pass/fail)
6. **输出规范**: 要求 agent 输出结构化的 JSON 结果

## 配置文件结构

### 轻量工作流

```yaml
workflow:
  name: 工作流名称
  description: 工作流描述
  mode: state-machine
  profile: lightweight
  states:
    - name: 执行
      isInitial: true
      isFinal: true
      steps:
        - name: 执行任务
          agent: agent名称
          task: 完整目标与验收条件
      transitions: []

context:
  projectRoot: 项目根目录
  requirements: 需求描述
  skills: [工作流级技能列表]
```

轻量工作流只有一个执行状态和一个执行 Agent，不设置 `maxTransitions`、`supervisor` 或步骤级 `skills`。

### 状态机

```yaml
workflow:
  name: 工作流名称
  description: 工作流描述
  mode: state-machine
  maxTransitions: 最大转换次数
  supervisor:
    enabled: true
    agent: default-supervisor
  states:
    - name: 状态名称
      description: 状态描述
      isInitial: true/false
      isFinal: true/false
      requireHumanApproval: true/false
      position:
        x: 100
        y: 200
      steps:
        - name: 步骤名称
          agent: agent名称
          role: defender/attacker/judge
          task: 任务描述
          skills: [步骤专属技能]
      transitions:
        - to: 目标状态
          condition:
            verdict: pass/conditional_pass/fail
          priority: 优先级
          label: 转换标签

context:
  projectRoot: 项目根目录
  requirements: 需求描述
  codebase: 代码库路径
  timeoutMinutes: 超时时间（分钟）
  skills: [全局技能列表]
```

轻量工作流不提供步骤级 `skills` 配置，内部任务清单 Skill 由系统自动维护。状态机工作流保留步骤级 `skills`，可在步骤编辑器中按步骤配置；Agent 的 `skills` 用于角色级复用。

## 更多信息

- 查看 `configs/agents/` 目录了解可用的 agent 配置
- 查看 `skills/` 目录了解可用的技能
- 参考 `docs/` 目录了解 Supervisor 智能路由和工作流引擎的详细文档
