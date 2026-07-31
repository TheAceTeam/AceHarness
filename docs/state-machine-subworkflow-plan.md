# 状态机子工作流设计计划

本文档描述 ACEHarness 状态机工作流的“子工作流”能力设计。子工作流指：在一个状态机工作流的某个步骤中，嵌入并执行另一个状态机工作流。目标不是新增一套独立系统，而是让它完整融入现有工作流能力：用户仍然在状态机里添加步骤、启动工作流、查看运行页、处理人工确认、查看运行历史和 Git diff，只是步骤多了一种执行方式。

> **当前契约（2026-07-28）：** 工作流仅支持状态机运行时，不保留阶段式工作流或其迁移/兼容路径。子工作流通过 `subworkflow` 步骤执行；不创建工作流 Agora 多 Agent 群聊。保留的 `/api/workflow/*` 是状态机运行 API，不是已移除的 slash 创建入口。

核心原则：

- 子工作流只支持 `workflow.mode: state-machine`。
- 子工作流是 `states[].steps[]` 的一种步骤类型。
- 父工作流执行到子工作流步骤时阻塞等待 child run 完成。
- child run 是独立 run，有自己的 `runId`、`state.yaml`、event log、stream、outputs。
- parent run 记录 child run 摘要和父子关系。
- 默认继承父 run 的真实运行工作区，而不是 child YAML 中原始 `context.projectRoot`。
- 运行时使用配置快照，父流程启动后即使 child YAML 被修改，也不影响当前 run。
- 支持嵌套子工作流，但禁止循环引用，并限制最大嵌套深度。
- 支持子工作流步骤参与现有并发步骤机制。
- 人工确认、停止、恢复、重跑、运行历史、导入导出、SpecCoding、Git diff 都要保持一致体验。

## Stage 1：配置模型、Schema 和依赖快照

### 1.1 Step 配置形态

现有普通步骤保持兼容：

```yaml
- name: 实现功能
  agent: developer
  task: 完成实现
```

不写 `type` 时等价于：

```yaml
- name: 实现功能
  type: agent
  agent: developer
  task: 完成实现
```

新增子工作流步骤的简写形式：

```yaml
- name: 前端实现
  type: subworkflow
  workflow: frontend-implementation.yaml
```

高级形式：

```yaml
- name: 前端实现
  type: subworkflow
  workflow: frontend-implementation.yaml
  inputs:
    requirements: inherit
    workspace: inherit
    context: inherit
    specCoding: inherit
    globalContext: inherit
    stateContexts: relevant
    mcpServers: merge
    skills: merge
    engine: child
  result:
    completed: pass
    failed: fail
    stopped: fail
    crashed: fail
  runtime:
    humanQuestions: bubble
    stopPropagation: cascade
    timeoutMinutes: 120
    maxDepth: 3
    workspaceConflictPolicy: shared
    onUnjoinedBranches: stop
```

字段语义：

- `workflow`：引用的子工作流配置文件。推荐使用 runtime workflow config 根目录下的相对路径。
- `inputs.requirements`：
  - `inherit`：继承父 workflow 当前 requirements。
  - 字符串：使用自定义 requirements，并可在运行时追加父上下文。
- `inputs.workspace`：
  - `inherit`：继承父 run 的真实工作目录。
  - `child-isolated-copy`：给 child 单独复制工作区。
  - `config`：使用 child YAML 自己的 `context.projectRoot`。
- `inputs.context`：
  - `inherit`：继承父上下文。
  - `none`：不注入父上下文。
  - `custom`：以后支持用户指定上下文模板。
- `inputs.specCoding`：
  - `inherit`：继承父 run 的 SpecCoding 投影。
  - `none`：child 单独运行，不接收父 SpecCoding。
- `inputs.globalContext`：
  - `inherit`：继承父 globalContext。
  - `none`：不继承。
  - `custom`：以后支持自定义。
- `inputs.stateContexts`：
  - `inherit`：继承所有状态上下文。
  - `none`：不继承。
  - `relevant`：只继承当前父状态和最近步骤摘要。
- `inputs.mcpServers`：
  - `inherit`：使用父 workflow 的 MCP。
  - `merge`：父子合并。
  - `child-only`：只用 child config。
  - `parent-only`：只用 parent config。
- `inputs.skills`：同 MCP 策略。
- `inputs.engine`：
  - `inherit`：使用父 engine 策略。
  - `child`：优先 child config。
  - `override`：使用 step 显式配置。
- `result.*`：child 结束状态映射到 parent 状态机 verdict。
- `runtime.humanQuestions`：
  - `bubble`：child 人工问题冒泡到父/root UI。
  - `child-only`：仅在 child run 上显示。
- `runtime.stopPropagation`：
  - `cascade`：停止 parent 时停止 child。
  - `detach`：停止 parent 时 child 可继续运行。
- `runtime.workspaceConflictPolicy`：
  - `shared`：并发 child 共享父工作区。当前版本只支持该模式；不再预留 `isolated-copy` / `isolated-branch`。
- `runtime.onUnjoinedBranches`：
  - `stop`：`any/quorum` 达成后停止未 join 分支。
  - `detach`：未 join 分支继续运行但脱离父路径。
  - `wait-background`：父继续，后台跟踪未 join 分支。

### 1.2 Schema 规则

- `WorkflowStep` 改为兼容 union：
  - agent step：`type?: 'agent'`，`agent/task` 必填。
  - subworkflow step：`type: 'subworkflow'`，`workflow` 或 `subworkflow.configFile` 必填，`agent/task` 不必填。
- 旧配置不写 `type` 时保持正常运行。
- 子工作流 config 必须存在。
- 子工作流 config 必须是 state-machine。
- 子工作流 step 不参与 agent 存在性校验。
- 子工作流 step 可以保留 `specTaskBinding`，用于父 Spec task 的状态联动。
- `countWorkflowSteps` 第一版把一个 subworkflow step 算作 1；运行详情里单独显示 child 的内部进度。
- workflow import/export、copy/archive 要保留子工作流引用。
- config validate API 要能返回缺失 child workflow、循环引用、超过深度等错误。

### 1.3 配置快照和依赖图

父 YAML 不内联 child YAML。父 YAML 只保存引用：

```yaml
- name: 前端实现
  type: subworkflow
  workflow: frontend-implementation.yaml
```

root run 启动时解析完整依赖图：

- parent workflow。
- direct child workflows。
- grandchild workflows。
- 更深层依赖，直到最大深度。

启动时保存快照：

```text
runs/<rootRunId>/configs/
  manifest.json
  parent.yaml
  child-a.yaml
  child-b.yaml
  grandchild-c.yaml
```

`manifest.json` 示例：

```json
{
  "root": "parent.yaml",
  "createdAt": "2026-06-26T00:00:00.000Z",
  "manifestHash": "sha256-...",
  "configs": [
    {
      "file": "parent.yaml",
      "snapshot": "configs/parent.yaml",
      "sha256": "...",
      "workflowName": "主工作流",
      "mode": "state-machine"
    },
    {
      "file": "frontend-implementation.yaml",
      "snapshot": "configs/frontend-implementation.yaml",
      "sha256": "...",
      "workflowName": "前端实现子流程",
      "mode": "state-machine",
      "referencedBy": ["parent.yaml"]
    }
  ]
}
```

运行规则：

- parent run 启动后，所有 child/grandchild 都从 root run snapshot 读取，不读实时 YAML。
- 如果磁盘上的 child YAML 后续被修改，只影响新的 run。
- resume、crash recovery、force transition 默认使用 run snapshot。
- rerun from step 默认使用原 run snapshot，以保证可复现。
- UI 可提供“使用最新配置重跑”，但必须显式选择，并创建新的 snapshot。
- 单独启动 child workflow 时，它作为 root run 创建自己的 snapshot。
- snapshot manifest 要记录原始相对文件名，方便导入导出和审计。
- snapshot 解析必须拒绝缺失 child reference，除非未来支持 optional child。
- snapshot 路径必须规范化，禁止 `..`、绝对路径、Windows drive-prefix tricks、重复 canonical path。
- snapshot 写入要原子化，避免 run 启动过程中崩溃留下半截配置。

## Stage 2：嵌套、循环检测和配置安全

### 2.1 嵌套规则

允许多层嵌套：

```text
main.yaml -> frontend.yaml -> ui-review.yaml
```

每个 child run 都写入：

- `rootRunId`
- `parentRunId`
- `parentConfigFile`
- `parentStateName`
- `parentStepId`
- `parentStepName`
- `nestingPath`

`nestingPath` 示例：

```ts
[
  { runId: 'run-parent', configFile: 'main.yaml', stepName: 'Root' },
  { runId: 'run-child-a', configFile: 'frontend.yaml', stepName: '前端实现' }
]
```

默认最大深度建议为 3。即使 workflow config 允许更高，也应有系统级硬上限，例如 5 或 8。

### 2.2 循环检测

禁止直接循环：

```text
A -> A
```

禁止间接循环：

```text
A -> B -> A
A -> B -> C -> A
```

保存/校验配置时检查一次。运行时启动 child 前再检查一次。运行时检查使用当前 `nestingPath`，可以覆盖导入、编辑、快照异常等场景。

运行前校验逻辑：

```ts
if (nestingPath.some((item) => item.configFile === childConfigFile)) {
  throw new Error(`检测到子工作流循环: ${path} -> ${childConfigFile}`);
}

if (nestingPath.length >= maxDepth) {
  throw new Error(`子工作流嵌套超过最大深度 maxDepth=${maxDepth}`);
}
```

错误处理：

- 校验阶段：阻止保存或启动，并显示完整调用链。
- 运行阶段：让当前 subworkflow step 失败，再按 step 的 result mapping 映射为 parent verdict。
- 循环检测必须使用 canonical config identity，不能只用 workflow name，因为名称可能重复。
- config identity 推荐使用 snapshot manifest 中的 normalized config file ID。

### 2.3 路径和引用安全

- child workflow 引用必须解析到 runtime workflow config 根目录或批准的 bundled config 根目录。
- 禁止通过 `../` 引用任意文件。
- 禁止通过绝对路径绕过 runtime config 管理。
- Windows 下要规范化 drive letter、反斜杠、大小写差异。
- 导入 workflow bundle 时要检查 zip slip。
- 同一个 canonical path 不允许在 manifest 中出现多份不同内容。
- snapshot integrity 校验失败时，run 标记为 crashed，并给出明确恢复错误。

## Stage 3：运行模型和 Manager 生命周期

### 3.1 执行入口

状态机执行中，所有 step 统一走 dispatch：

```ts
async function executeWorkflowStepDispatch(step, state, config, requirements, extraContext) {
  if (step.type === 'subworkflow') {
    return executeSubworkflowStep(step, state, config, requirements, extraContext);
  }
  return executeStep(step, state, config, requirements, extraContext);
}
```

串行和并发都必须使用同一个 dispatch，保证行为一致。

### 3.2 `executeSubworkflowStep`

执行流程：

1. 生成 parent step execution ID。
2. 计算 parent step key。
3. 标记 parent step active。
4. 记录 parent step git before snapshot。
5. 更新父 Spec task 为 `in-progress`。
6. 从 root run snapshot 读取 child config。
7. 基于 parent runtime context 构造 effective child config。
8. 创建 child runId。
9. 创建或获取 child manager。
10. 写 parent run 的 `activeSubworkflowRunId` 和 `subworkflowRuns`。
11. 启动 child manager。
12. parent manager `await` child 完成。
13. 读取 child final state。
14. 生成 parent synthetic output。
15. 根据 child status 和 result mapping 生成 parent verdict。
16. 记录 parent step log。
17. 记录 parent step git after snapshot。
18. 更新父 Spec task 为 `completed` 或 `blocked`。
19. 标记 parent step completed/failed。
20. emit subworkflow complete/failed event。

synthetic output 示例：

```md
子工作流执行完成。

- childRunId: run-child-xxx
- configFile: frontend-implementation.yaml
- snapshot: configs/frontend-implementation.yaml
- status: completed
- completedSteps: 8
- failedSteps: 0

## Summary

前端实现已完成，包含组件、样式和基础测试。

<workflow-verdict>{"verdict":"pass","summary":"子工作流完成"}</workflow-verdict>
```

失败 output 示例：

```md
子工作流执行失败。

- childRunId: run-child-xxx
- configFile: frontend-implementation.yaml
- status: failed
- error: 测试状态未通过

<workflow-verdict>{"verdict":"fail","summary":"子工作流失败"}</workflow-verdict>
```

### 3.3 Registry 改造

当前 registry 主要按 `configFile -> manager`。子工作流需要扩展为：

- `managerKey -> manager`
- `runId -> manager`
- `configFile -> manager[]`

规则：

- 顶层 workflow 仍然按 configFile 防重复启动。
- child workflow 使用独立 managerKey。
- 同一个 child config 可以被不同 parent 并发调用。
- `getManagerByRunId` 必须支持 child run。
- `getRunningManagers` 必须包含 child managers，这样 human question API 能扫到 child。
- `getRunningManager(configFile)` 保持旧行为，主要用于顶层兼容。
- registry 转发事件时附带：
  - `runId`
  - `configFile`
  - `rootRunId`
  - `parentRunId`
  - `nestingPath`
  - `traceId`
  - `spanId`

### 3.4 Manager 生命周期

- parent stop 时按策略 cascade stop active child。
- child 完成后从 active map 标记结束，但保留 runId 查询能力。
- cleanup 不得清理 running child manager。
- parent resume 时要重建 active child 关系。
- child crashed 时 parent 能读取 child state 并按 result mapping 处理。
- force transition 支持 parent 和 child。
- force complete 支持 parent subworkflow step 和 child 当前 step。
- rerun from parent subworkflow step 会创建新的 child attempt。

### 3.5 幂等和 attempt

subworkflow start 必须幂等：

- 如果 parent 已经记录同一个 step attempt 的 active child，重试时复用它。
- 如果 child 已 completed，直接从 child state 合成 parent output。
- 如果 child 已 failed/stopped，确保 result mapping 只应用一次。

每次子工作流执行记录：

- `attempt`
- `managerKey`
- `childRunId`
- `status`
- `supersededByRunId`
- `abandonedAt`
- `cancelledAt`

child 生命周期状态：

- `pending`
- `starting`
- `running`
- `waiting-human`
- `completed`
- `failed`
- `stopped`
- `crashed`
- `cancelled`
- `abandoned`
- `superseded`

## Stage 4：配置透传、上下文继承和结果回传

### 4.1 Effective child config

child YAML 本身保持独立可运行。嵌入执行时构造 effective config：

- child YAML 原始配置。
- parent runtime workspace 覆盖。
- parent requirements 注入。
- parent/global/state context 注入。
- parent user/session metadata 注入。
- SpecCoding 投影注入。
- MCP/skills/engine 根据策略合并。

默认策略：

- `requirements: inherit`
- `workspace: inherit`
- `context: inherit`
- `specCoding: inherit`
- `globalContext: inherit`
- `stateContexts: relevant`
- `mcpServers: merge`
- `skills: merge`
- `engine: child`
- `humanQuestions: bubble`
- `stopPropagation: cascade`

最关键的 workspace 规则：

- 父 workflow 如果使用 `isolated-copy`，child 默认跑在父 run 的 isolated dir。
- 父 workflow 如果使用 `in-place`，child 默认跑在同一个项目目录。
- child config 里的 `context.projectRoot` 在嵌入执行时默认被 runtime workspace 覆盖。
- 只有显式配置 `workspace: config` 时才使用 child 自己的 `context.projectRoot`。

### 4.2 Parent context 注入

child start 时注入标准上下文块：

```md
# Parent Workflow Context

- rootRunId: run-root
- parentRunId: run-parent
- parentWorkflow: 主工作流
- parentConfigFile: main.yaml
- parentState: 实现
- parentStep: 前端实现
- childConfigFile: frontend-implementation.yaml

## Parent Requirements

...

## Parent State Summary

...

## Previous Step Summary

...

## Human Answers

...

## SpecCoding Projection

...
```

注入位置：

- 推荐通过 `initialContexts.globalContext` 或专门的 `parentContext` 字段传给 child manager。
- 不建议直接改写 child YAML 文件。
- run state 中记录 effective context 摘要，避免日志过大。

### 4.3 Agent session 继承

默认不继承 agent session，原因：

- 不同 workflow 中同名 agent 的任务上下文可能不同。
- 直接复用 session 容易污染 child workflow。
- child workflow 应该保持可单独运行。

可选策略：

- `none`：不继承，默认。
- `same-name`：同名 agent 继承。
- `explicit`：用户显式配置哪些 agent 继承。

Supervisor session 同理，默认不继承，但 parent/root chat session 可以继承，用于 UI 统一显示。

### 4.4 结果回传

child 完成后回传：

- child status。
- child verdict。
- child summary。
- child issues。
- child artifacts。
- child completed/failed step count。
- child token/cost/duration。
- child final review。
- child run link。

parent 处理：

- 写 synthetic step output。
- 写 parent stepLog。
- 更新 `completedSteps` 或 `failedSteps`。
- 更新 parent issueTracker。
- 更新 parent stateContexts。
- 更新 parent run summary。
- 更新 parent Spec task 状态。

result mapping 必须总是产生合法 verdict：

- `pass`
- `conditional_pass`
- `fail`

缺失 child state、snapshot 损坏、child manager 无法恢复等情况默认映射为 `fail`，并输出诊断信息。

## Stage 5：并发子工作流和工作区冲突策略

### 5.1 并发步骤支持

子工作流 step 可以参与现有 `parallelGroup`：

```yaml
steps:
  - name: 前端实现
    type: subworkflow
    workflow: frontend.yaml
    parallelGroup: implementation

  - name: 后端实现
    type: subworkflow
    workflow: backend.yaml
    parallelGroup: implementation

  - name: 联调检查
    agent: tester
    task: 检查前后端联调
```

执行效果：

- `frontend.yaml` 和 `backend.yaml` 同时启动 child runs。
- 父状态等待并发组 join。
- join 完成后进入后续步骤。

### 5.2 Join policy

复用现有 join policy：

- `all`：等待所有分支完成。
- `any`：任一分支满足即可继续。
- `quorum`：达到指定数量即可继续。
- `manual`：进入人工 join 决策。

新增 `onUnjoinedBranches`：

- `stop`：停止未完成分支，默认推荐。
- `detach`：未完成分支继续运行，但不再影响 parent 路径。
- `wait-background`：parent 继续运行，后台仍跟踪分支完成结果。

默认规则：

- `all`：等待全部。
- `manual`：由人工决定。
- `any/quorum`：默认 `stop`，避免未 join child 继续修改共享工作区。

### 5.3 ParallelBranchResult

每个并发分支输出：

```ts
{
  step,
  status: 'fulfilled' | 'rejected',
  output,
  error,
  verdict,
  issues,
  childRunId,
  childConfigFile,
  childStatus
}
```

并发组 verdict 聚合：

- 任一 joined branch 为 `fail` => group `fail`。
- 否则任一 joined branch 为 `conditional_pass` => group `conditional_pass`。
- 否则 group `pass`。
- cancelled unjoined branch 默认不参与 verdict。
- 如果用户配置 cancelled 也算 fail，则按配置处理。

### 5.4 并发 workspace policy

并发 child workflows 共享 workspace 可能冲突。例如前端和后端改不同目录通常可行，但两个 child 同时改同一文件会有风险。

当前版本只支持 `shared`：

- 所有 child 直接改 parent runtime workspace。
- 最快，最贴近当前执行模型。
- 风险是文件冲突和不可预测覆盖。
- 配置中如果写入 `isolated-copy` 或 `isolated-branch`，schema 校验应直接拒绝。

UI 行为：

- 当并发组里有多个 subworkflow 且使用 `shared` 时显示风险提示。
- 如果 git diff 可用，检测 overlapping changed paths。
- 如果 child branches 修改同一文件，join 后显示冲突警告。

### 5.5 并发中的人工确认和控制

child branch 进入人工确认时：

- branch 状态变为 `waiting-human`。
- parent 并发组显示“部分分支等待人工”。
- HumanQuestion breadcrumb 包含：
  - parent workflow。
  - parent state。
  - parallel group ID。
  - branch step name。
  - child workflow。
  - child state/step。

控制能力：

- stop parent => stop 所有 active child branches。
- rerun one branch。
- rerun failed branches。
- rerun whole parallel group。
- force-complete one branch。
- force-complete whole group。

## Stage 6：运行状态、事件、人工确认和恢复控制

### 6.1 Run state 扩展

`PersistedRunState` 增加：

```ts
interface SubworkflowRunRef {
  parentStepId: string;
  parentStepName: string;
  parentStateName?: string;
  configFile: string;
  snapshotFile?: string;
  runId: string;
  attempt: number;
  status: 'pending' | 'starting' | 'running' | 'waiting-human' | 'completed' | 'failed' | 'stopped' | 'crashed' | 'cancelled' | 'abandoned' | 'superseded';
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  verdict?: 'pass' | 'conditional_pass' | 'fail';
  error?: string;
}
```

parent run state：

- `rootRunId`
- `childRunIds`
- `subworkflowRuns`
- `activeSubworkflowRunId`

child run state：

- `parentRunId`
- `rootRunId`
- `parentConfigFile`
- `parentStateName`
- `parentStepId`
- `parentStepName`
- `nestingPath`

`PersistedStepLog` 增加：

- `stepType`
- `childRunId`
- `childConfigFile`
- `childStatus`
- `childSummary`
- `childVerdict`

### 6.2 Event system

新增事件：

- `workflow.subworkflow-start`
- `workflow.subworkflow-status`
- `workflow.subworkflow-waiting-human`
- `workflow.subworkflow-complete`
- `workflow.subworkflow-failed`
- `workflow.subworkflow-stopped`
- `workflow.subworkflow-cancelled`

parent event-log 保存摘要事件。child event-log 保存完整事件。

事件 payload 要包含：

- `runId`
- `rootRunId`
- `parentRunId`
- `configFile`
- `childRunId`
- `childConfigFile`
- `stateName`
- `stepName`
- `parallelGroup`
- `traceId`
- `spanId`
- `workflowPath`

event payload 必须 compact，不能把 child 全量 output 塞进 parent event。

### 6.3 Trace 和观测

每个 root run 生成 `traceId`。

每个状态、步骤、child run、并发分支生成 `spanId`。

用途：

- event log 按 trace 查询。
- 日志串联 parent/child。
- UI 可以按 root/direct child/full descendants 过滤。
- 失败诊断能定位 child run 和 parent step。

parent run summary 增加：

- child count。
- active child count。
- failed child count。
- waiting-human child count。
- detached child count。

### 6.4 HumanQuestion 扩展

`HumanQuestion` 增加：

- `parentRunId`
- `rootRunId`
- `workflowPath`
- `sourceRunId`
- `sourceConfigFile`

`workflowPath` 示例：

```ts
[
  {
    runId: 'run-parent',
    workflowName: '主工作流',
    stateName: '实现',
    stepName: '前端实现'
  },
  {
    runId: 'run-child',
    workflowName: '前端子流程',
    stateName: '发布检查',
    stepName: '确认是否发布'
  }
]
```

行为：

- child human question 默认冒泡到 parent/root UI。
- 首页待人工处理列表显示 child 来源路径。
- HumanQuestionInbox 显示 breadcrumb。
- 回答时通过 `runId` 定位 child manager。
- child 等待期间 parent 也显示等待子工作流人工确认。
- parent accumulated wait time 包含 child 等待时间。
- `<human-help>{...}</human-help>` 规则对子工作流同样生效。

### 6.5 停止、恢复、重跑

Stop：

- stop parent 默认 cascade stop active child。
- stop child 只影响 child，然后映射回 parent。
- detach child 不随 parent 停止，但必须在 UI 中标明 detached。

Resume：

- parent resume 时先读取 active child state。
- 如果 child completed，合成 parent output。
- 如果 child running，重建 child manager 并继续等待。
- 如果 child waiting human，恢复待人工状态。
- 如果 child crashed，按恢复策略处理。

Rerun：

- rerun parent subworkflow step 创建新的 child run attempt。
- 旧 child run 标记为 `superseded`。
- 可支持只 rerun failed child branches。
- 默认使用原 snapshot。
- 显式选择时可使用最新 config 创建新 snapshot。

Force：

- force transition parent 时处理 active child：
  - stop child。
  - detach child。
  - mark child abandoned。
- force transition child 只影响 child run。
- force complete parent subworkflow step 需要选择：
  - 直接完成 parent step。
  - force complete child 当前 step。

Timeout：

- `fail`：child timeout 后 parent step fail。
- `stop child`：停止 child，并按 stopped mapping。
- `ask human`：发起人工确认。

## Stage 7：前端设计器、运行页和历史视图

### 7.1 设计器体验

复用现有 `EditNodeModal`，不要新增孤立页面。

步骤编辑弹窗顶部增加 step type：

- Agent 步骤。
- 子工作流。

Agent 步骤保持原字段：

- name。
- agent。
- task。
- constraints。
- skills。
- preCommands。
- Spec 绑定。
- 并发设置。

子工作流步骤显示：

- 步骤名称。
- 子工作流配置选择器。
- 可选任务说明 / requirements override。
- 输入继承 preset。
- result mapping。
- runtime advanced settings。
- Spec 绑定。
- 并发设置。

workflow selector：

- 只显示 state-machine workflow。
- 显示 workflow name。
- 显示 filename。
- 显示 description。
- 显示 states count。
- 显示 steps count。
- 显示是否被其他 workflow 引用。
- 显示是否存在循环风险。

步骤卡片显示：

```text
[子工作流] 前端实现
frontend-implementation.yaml
继承父工作区 · 人工确认冒泡 · completed => pass
```

状态机图：

- 子工作流步骤使用特殊 icon。
- 不默认展开 child 的完整状态图。
- 点击可打开 child workflow preview。

### 7.2 运行页

父运行页里，子工作流步骤显示为一个普通步骤加 child 摘要：

```text
当前步骤：前端实现
类型：子工作流
子工作流：frontend-implementation.yaml
状态：running
childRunId：run-child-xxx
当前子状态：编码
当前子步骤：实现组件
进度：3 / 8
[查看子流程]
```

点击查看子流程：

- 在右侧 dock 打开 child execution view。
- 或 modal 全屏查看。
- 不跳走父流程上下文。

breadcrumb：

```text
主工作流 > 实现 > 前端实现 > 前端子流程 > 编码
```

timeline：

- 默认只显示 child 摘要事件。
- 可切换显示 child full events。
- 不默认把 child 所有事件平铺进 parent。

Token tab：

- parent only。
- include children。
- by child workflow。
- by agent。

Issue tab：

- parent issues。
- child issues。
- grouped by child workflow。

Git diff：

- parent subworkflow aggregate diff。
- child per-step diff。

### 7.3 运行历史

运行历史支持树：

```text
run-parent 主工作流
  └─ run-child-a 前端实现
      └─ run-grandchild-a UI 验证
  └─ run-child-b 后端实现
```

支持：

- 展开/折叠 child runs。
- 查看 child status。
- 查看 child summary。
- 查看 detached/superseded/abandoned 标记。
- 删除 parent 时可选删除 child runs。
- detached child 默认不随 parent 删除，除非用户显式选择。

### 7.4 人工确认 UI

child 发起人工确认时，显示：

```text
子工作流正在等待人工确认

来源：
主工作流 / 实现 / 前端实现
子工作流 / 发布检查 / 确认是否发布

问题：
...

[回答]
```

首页、运行页、HumanQuestionInbox 仍复用现有卡片，只增加 breadcrumb 和 child run 链接。

## Stage 8：API、导入导出、SpecCoding 和 Git 集成

### 8.1 API

需要调整或新增：

- `/api/workflow/start`
  - root start 创建 dependency snapshot。
  - 内部 child start 复用启动逻辑，但不一定暴露公开 endpoint。
- `/api/workflow/status`
  - 支持通过 `runId` 查询 parent/child。
  - 支持返回 child summary。
- `/api/workflow/context`
  - 支持 child context。
- `/api/workflow/events`
  - 推送 child metadata。
  - 支持 trace/root filtering。
- `/api/workflow/event-log`
  - 支持 child run。
- `/api/workflow/stop`
  - 支持 cascade/detach。
- `/api/workflow/force-transition`
  - 支持 child runId。
- `/api/workflow/force-complete`
  - 支持 child runId。
- `/api/workflow/rerun-from-step`
  - 支持 subworkflow step。
  - 支持 rerun branch/group。
- `/api/run-history`
  - 返回 parent-child tree。
- `/api/config/validate`
  - 校验 child references、snapshot graph、cycle、depth。
- `/api/config/archive`
  - 可选导出 dependency workflows。
- `/api/config/import`
  - 解析 dependency workflows。
- workflow reference API：
  - 查询某 workflow 被哪些 parent 引用。

权限：

- child run owner 继承 parent owner。
- 能访问 child 的用户必须能访问 root/parent run。
- child API 不能暴露 parent 无权访问的 workspace path。
- 内部 child start helper 不能绕过公开 API 的认证边界。

### 8.2 导入导出和依赖管理

导出 parent workflow 时选项：

- 只导出 parent。
- 导出 parent + direct children。
- 导出 parent + full dependency graph。

导入时：

- 解析 child references。
- 检查缺失 workflow。
- 支持 reference remap。
- 检查循环。
- 检查路径安全。
- 保留 portable workflow 能力。

删除/重命名 workflow：

- 删除前提示被哪些 parent 引用。
- 重命名时可选择更新引用。
- 如果不更新，parent validate 显示缺失 child。

### 8.3 SpecCoding

子工作流 step 可绑定 parent Spec task。

父 Spec task 状态：

- child started => `in-progress`。
- child completed => `completed`。
- child failed/stopped/crashed => `blocked`。

child 内部也可有自己的 step-task bindings。

child SpecCoding 修订：

- 写入 child run delta。
- parent final review 可汇总 child delta。
- parent final merge 时可包含 child delta。
- child revision vote 在 parent UI 展示摘要。
- child artifacts 关联 parent Spec task。

AI workflow draft：

- 可以建议引用已有 child workflow。
- 生成 subworkflow step 时必须检查 child config 存在且是 state-machine。

### 8.4 Git 和 workspace

默认：

- child 复用 parent runtime workspace。
- child 不重复 isolated-copy。
- child 记录自己的 per-step git snapshots。
- parent subworkflow step 的 before/after snapshot 包住整个 child 执行。

diff UI：

- parent aggregate diff。
- child per-step diff。
- child branch diff。
- overlapping paths warning。

cleanup：

- child workspace cleanup 跟随 parent。
- 删除 parent workspace 前确认所有 child 都使用同一默认 workspace。
- 手动绑定 workspace 不自动删。
- detached child workspace 不隐式删。

## Stage 9：测试和验证

### 9.1 单元测试

Schema：

- 旧 agent step 兼容。
- subworkflow step 合法。
- child 必须 state-machine。
- child config missing。
- direct cycle。
- indirect cycle。
- max depth。
- path traversal rejected。

Snapshot：

- root start 生成 manifest。
- child 从 snapshot 读取。
- live child YAML 修改不影响 active run。
- resume 使用 snapshot。
- corrupted snapshot 报错。

Manager：

- child completed => parent pass。
- child failed => parent fail。
- result mapping 生效。
- parent waits child。
- child human question bubble。
- parent stop cascade child。
- parent resume reads child。
- child crashed recovery。
- rerun creates new attempt。

Registry：

- 同 configFile 多 child 并发。
- `getManagerByRunId` 支持 child。
- top-level duplicate still rejected。
- cleanup 不清 running child。

Parallel：

- subworkflow branch participates in `all`。
- `any` stops unjoined branch。
- `quorum` aggregation。
- manual join human question。
- shared workspace warning metadata。

Run state：

- parent/child persisted。
- `subworkflowRuns` updated。
- run history tree。
- stepLog includes child metadata。

API：

- start/status/stop/human answer/event-log。
- permissions。
- config validate。
- archive/import dependencies。

UI：

- step type switch。
- child workflow selector。
- child preview。
- runtime child summary。
- child dock view。
- human question breadcrumb。
- run history tree。

E2E：

- parent 调 child 成功。
- child 等待人工后继续。
- child 失败驱动 parent fail transition。
- parallel child workflows run together。
- parent resume after child completed。

### 9.2 迁移兼容

- 旧 workflow 不写 `type` 正常运行。
- 旧 run state 没有 parent/child 字段正常显示。
- 旧 summary cache 正常显示。
- API response 保留旧字段。
- UI 只有 step type 是 subworkflow 时显示新控件。
- 旧配置如果有实验性字段，做 alias normalize。
- 未知 `type` 给清晰错误。
- 文档明确：child workflow 只支持 state-machine。

### 9.3 文档和示例

新增示例：

- parent 调单个 child。
- parent 并发调前端/后端 child。
- child 内嵌 grandchild。
- child human question bubble。
- child failed result mapping。
- run snapshot 说明。

README 增加：

- 子工作流概念。
- 配置示例。
- 默认继承策略。
- 并发风险。
- 循环限制。
- 快照行为。

## Stage 10：工程硬化、资源上限和发布策略

### 10.1 资源上限

增加系统保护：

- 单 parent 最大 active child runs。
- 单 root run 最大 child runs。
- 单 parallel group 最大 child branches。
- 最大 dependency graph size。
- 最大 snapshot bytes。
- 最大 child wall-clock duration。
- 最大 child event count。
- 最大 child output summary bytes。

超过上限：

- 启动前能检测则直接 validate fail。
- 运行中超过则停止 child step，并按 result mapping。
- UI 给出明确错误。

当前第一版已落地的默认硬限制：

- 单 parent active child runs：8。
- 单用户 active child runs：16。
- 单 root run child runs：64。
- 单 parallel group subworkflow branches：8。
- dependency graph size：32 个配置。
- snapshot bytes：2 MiB。
- child event count：500。
- child output summary bytes：16 KiB。
- child wall-clock duration：通过 `runtime.timeoutMinutes` 配置。
- timeout 策略：默认 `stop`；可配置 `timeoutStrategy: ask-human`，停止 child 后由人工决定 parent 是否以 `conditional_pass` 放行。

### 10.2 审计和安全

记录：

- 谁启动 parent。
- 谁回答 child human question。
- 谁 force-transition parent/child。
- 谁 rerun child branch。
- 使用哪个 snapshot manifest。
- 使用哪个 result mapping。

当前第一版已落地轻量审计：

- parent run state 记录 `subworkflowAuditEvents`。
- 每个 run 目录记录独立 `audit.jsonl`，并提供 `/api/workflow/audit-log` 查询。
- 审计动作包括 `start`、`status`、`waiting-human`、`human-answer`、`force-complete-child`、`rerun-supersede`、`result-mapping`。
- 审计事件记录 actor、requestId、IP、User-Agent、parent/root run、child run、child config、state、step、before/after 状态摘要和 result mapping 摘要。
- 子工作流 run ref 记录 `eventCount`，超过上限会中断子工作流步骤。
- 修改运行状态的 API 采用 owner/admin 权限矩阵：run owner 和 admin 可操作；无 owner 的历史 run 继续兼容；其他用户返回 403。
- `event-log`、`git-diff`、`run-history` 读取路径也加入 child/root owner 权限边界。
- 工作流重命名保存时可通过 `renameFrom` / `previousFilename` 自动更新可访问 parent references。
- 运行页支持嵌入式 child execution modal；仍保留打开完整 child workbench 的入口。

路径安全：

- 所有 child config path canonicalize。
- snapshot import/export 防 zip slip。
- workspace delete 只删系统默认创建目录。
- child run 不可提升权限访问 parent 无权路径。

### 10.3 完整性和锁定

- snapshot manifest 记录每个 config hash。
- run state 记录 manifest hash。
- resume 前校验 manifest hash。
- snapshot 缺失或损坏时，run 标记 crashed。
- crashed error 要包含恢复建议。

当前第一版已落地：

- `restoreRunStateForContinuation` 会在恢复前校验 run state 记录的 snapshot manifest hash。
- snapshot 缺失、manifest 损坏、config hash 不一致或 manifest hash 不匹配时，会把 run state 写回 `crashed`。
- `statusReason` 包含恢复建议：重新启动工作流，或从有效 run snapshot 恢复后再继续。

### 10.4 发布策略

建议分批落地：

1. Schema、validate、snapshot、循环检测。
2. Registry 和 child manager 基础执行。
3. Run state、event、human question bubble。
4. 串行 subworkflow UI。
5. 并发 subworkflow。
6. Git/SpecCoding/导入导出完善。
7. hardening 和 shared workspace 风险提示。

每批都应保证：

- 类型检查通过。
- 相关 vitest 通过。
- 旧 workflow 正常运行。
- 失败时错误信息可读。

## 建议实施顺序

1. 配置 schema 和 validate。
2. 配置快照和依赖图解析。
3. Registry keying 和 manager lookup 改造。
4. 串行 `executeSubworkflowStep`。
5. Run state 和 event persistence。
6. Human question bubbling。
7. Resume/stop/rerun/force 控制。
8. 设计器 UI 和运行页 UI。
9. 并发子工作流。
10. SpecCoding、Git、导入导出、hardening。
