---
name: csi-sdd-challenge
description: 用于独立挑战 design、plan 和 task 三份 SDD 产物的一致性与可实施性时。
disable-model-invocation: true
metadata:
  pattern: sdd-challenge
---

# SDD 方案挑战

## 目标

独立核验 `design.md`、`plan.md` 和 `task.md` 是否形成一致、可落地、可验证的 SDD，并记录有证据的 findings。挑战者维护挑战产物，不修改 SDD，也不作准入裁决。

## 输入处理

使用 Workflow 提供的正式输入。代码仓用于抽查设计声明和任务落点；需求澄清产物用于核验需求锚点，不作为新增设计来源。

## 挑战维度

### 1. Consistency

检查 plan 和 task 是否忠实展开 design，版本是否一致，架构、契约、围栏、迁移和验证顺序之间是否冲突。

### 2. Grounding

抽查任务目标路径、符号、依赖和复用模式是否有当前代码证据。Greenfield 定位策略是否来自设计确定的目标结构。

### 3. Dependency

检查任务依赖图、波次、关键路径和并行条件是否自洽，是否存在遗漏依赖、循环等待或共享写入冲突。

### 4. Executability

检查任务动作、完成条件、围栏和验证义务是否足以让后续实现角色执行和判定完成。

### 5. Coverage

检查每个设计变更单元是否有任务承接，每项任务是否有设计来源，保护区域是否保持一致，计划范围是否紧凑。

## Finding 规则

每项 finding 包含：

- `id`；
- `severity`：critical | major | minor；
- `dimension`：consistency | grounding | dependency | executability | coverage；
- `claim`；
- `evidence`；
- `impact`；
- `recommendation`；
- `resolution_status`：open | resolved。

修订轮次复核已有 finding，证据证明问题已经解决时设置为 `resolved`。

## 产物契约

Workflow 指定的 `design-challenge.md` 使用：

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: sdd-challenge
status: draft | reviewed
findings_status: open | resolved
input_versions:
  design: <design.md updated_at>
  plan: <plan.md updated_at>
  task: <task.md updated_at>
updated_at: <ISO-8601>
---
```

正文包含输入版本、五维结论、findings 和未核验证据。
