---
name: csi-sdd-planning
description: 用于根据已形成的需求设计和当前代码事实生成实施计划与任务清单时。
disable-model-invocation: true
metadata:
  pattern: sdd-planning
---

# SDD 实施规划

## 目标

把 `design.md` 中已经确定的目标架构、契约和围栏转化为有依赖顺序的 `plan.md` 和可执行的 `task.md`。

设计产物定义目标状态与变更围栏，代码仓定义当前实现和实际落点。两者不一致时记录 upstream gap，交由需求设计修订。

## 输入处理

使用 Workflow 提供的正式输入。先完整读取 `design.md`，再从设计声明的入口、模块和 test seam 定向核验代码。修订轮次同时读取既有计划、任务、挑战、评审和 DT 回流意见。

## 阶段一：设计与代码解剖

对每个设计变更单元确认：

- 对应的设计锚点、契约和围栏；
- 当前实现的文件、符号、调用方和依赖方；
- 可复用的相邻实现模式；
- 新增或变化的依赖边；
- 实施前需要解决的设计差距。

落点优先使用路径和符号；新文件使用目录与职责定位策略。行号只作为当前证据，不作为长期任务标识。

Greenfield 项目依据设计已经确定的技术栈和目标结构，把最低基础能力放在业务任务之前。设计尚未确定这些事实时记录为 upstream gap。

## 阶段二：形成实施计划

`plan.md` 描述如何组织实施：

- 实施策略和范围；
- 设计变更单元与代码现状差异；
- 任务依赖图和执行波次；
- 关键路径与可并行区域；
- 数据迁移、兼容、发布和回滚顺序；
- 验证义务的执行顺序；
- upstream gaps、风险及处理状态。

波次由真实依赖决定。同一波次中的任务必须能够在不读取彼此未完成结果的情况下执行。`plan.md` 只引用 Task ID 和摘要，任务正文由 `task.md` 维护。

## 阶段三：拆分实施任务

任务以可独立完成、可验证的变更单元为边界。每项任务包含：

- `task_id`；
- 来源设计锚点；
- 目标和实施动作；
- 目标路径、符号或新建定位策略；
- 可复用模式及代码证据；
- 前置依赖和后继阻塞关系；
- 所属波次和并行条件；
- 适用围栏；
- 完成条件；
- 设计已经声明的验证义务、验证入口和 test seam；
- 已存在且可核验的构建或检查命令。

任务粒度由耦合、依赖和可验证性决定。一个任务可以覆盖多个紧密耦合的设计锚点，一个设计锚点也可以拆为多个有顺序的任务，并保留完整映射。

详细测试用例、Oracle、fixture、依赖替代和测试文件落点由后续 DT 设计确定。`task.md` 为 DT 提供验证义务和入口。

## 阶段四：一致性自检与修订

提交挑战前检查：

1. design → plan → task 追踪是否完整；
2. 任务落点是否有代码证据或明确定位策略；
3. 依赖、波次和关键路径是否一致；
4. 任务是否保持设计围栏和契约；
5. 每项任务是否有可判定的完成条件；
6. 验证义务是否足以交给 DT 设计；
7. upstream gap 是否有证据、owner 和处理状态。

修订轮次逐项响应 `design-challenge.md`、`design-review.md` 和 `dt-quality-review.md`，在对应产物中记录处理位置和结果。

## `plan.md` 产物契约

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: sdd-plan
status: draft | blocked | ready
design_version: <design.md updated_at>
updated_at: <ISO-8601>
---
```

正文按实际需要包含：实施策略、变更范围、代码现状差异、依赖与波次、关键路径、迁移/发布/回滚顺序、验证顺序、upstream gaps 和风险。

## `task.md` 产物契约

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: sdd-tasks
status: draft | blocked | ready
design_version: <design.md updated_at>
plan_version: <plan.md updated_at>
updated_at: <ISO-8601>
---
```

正文包含 design → task 覆盖矩阵、按波次组织的任务清单、任务依赖关系、围栏、完成条件和 DT/验证输入。

没有未决 upstream gap，三层追踪完整且任务可执行时，将 `plan.md` 和 `task.md` 设置为 `ready`。
