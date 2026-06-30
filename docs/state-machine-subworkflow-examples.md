# 状态机子工作流示例

子工作流只支持 `workflow.mode: state-machine`。父工作流把一个子工作流当作普通 step 执行，运行时会创建 root run 的配置快照，child run 默认复用 parent workspace，并把 child 状态映射回 parent verdict。

## 单个子工作流

```yaml
workflow:
  name: Parent With Child
  mode: state-machine
  states:
    - name: Implement
      isInitial: true
      steps:
        - name: Run frontend workflow
          type: subworkflow
          workflow: children/frontend.yaml
          inputs:
            requirements: inherit
            workspace: inherit
            context: inherit
            skills: merge
            mcpServers: merge
            engine: child
          result:
            completed: pass
            failed: fail
            stopped: fail
            crashed: fail
          runtime:
            humanQuestions: bubble
            stopPropagation: cascade
            timeoutMinutes: 60
            maxDepth: 3
            workspaceConflictPolicy: shared
      transitions:
        - to: Done
          condition: { verdict: pass }
        - to: Implement
          condition: { verdict: conditional_pass }
        - to: Failed
          condition: { verdict: fail }
    - name: Done
      isFinal: true
      steps:
        - name: Finish
          agent: developer
          task: Finish the parent workflow.
      transitions: []
    - name: Failed
      isFinal: true
      steps:
        - name: Record failure
          agent: developer
          task: Record the failed child workflow result.
      transitions: []
context:
  projectRoot: /path/to/project
  workspaceMode: in-place
```

## 并发子工作流

同一 `parallelGroup` 内的 subworkflow step 会参与现有并发 join policy。当前 workspace conflict policy 只支持 `shared`，因此多个 child 同时修改同一 workspace 时应在任务说明中拆清文件边界。

```yaml
steps:
  - name: Frontend
    type: subworkflow
    workflow: children/frontend.yaml
    parallelGroup: feature-split
    concurrency:
      groupId: feature-split
      branchId: frontend
      joinPolicy: { mode: all }
    runtime: { workspaceConflictPolicy: shared }
  - name: Backend
    type: subworkflow
    workflow: children/backend.yaml
    parallelGroup: feature-split
    concurrency:
      groupId: feature-split
      branchId: backend
      joinPolicy: { mode: all }
    runtime: { workspaceConflictPolicy: shared }
```

## 人工确认冒泡

`runtime.humanQuestions: bubble` 是默认值。child 发起人工问题时，parent UI 会显示来源路径；回答时通过 child `runId` 定位实际等待的 manager。

```yaml
runtime:
  humanQuestions: bubble
```

如果设为 `child-only`，parent 只显示 child 处于 `waiting-human` 摘要状态，不把问题冒泡为 parent 的待处理问题。

## 超时人工确认

默认超时策略是 `stop`：child 超过 `runtime.timeoutMinutes` 后会停止，并按 `stopped` result mapping 回写 parent verdict。

如果希望超时后由人决定 parent 是否继续，可以设置：

```yaml
runtime:
  timeoutMinutes: 30
  timeoutStrategy: ask-human
```

该策略会先停止 child run，然后在 parent 上发起人工确认。选择“人工放行继续”时，parent step 记为 `conditional_pass`；child run 仍保留 `stopped`，便于审计。

## 审计与权限

- parent run state 会保留轻量 `subworkflowAuditEvents`。
- 每个 run 目录还会写入独立 `audit.jsonl`，可通过 `/api/workflow/audit-log?runId=...` 读取。
- audit v2 记录 `requestId`、IP、User-Agent、actor、before/after 状态摘要和 action details。
- 会改变运行状态的 API 要求 run owner 或 admin；无 owner 的旧 run 继续兼容。
- `event-log`、`git-diff`、`run-history` 会按 owner/admin 权限边界过滤。
- `audit.jsonl` 可按事件数或时间窗口压缩；detached child run 可由 retention 任务标记为 `abandoned`，默认不删除 workspace 或 run 数据。

## Final Review 中的 child Spec delta

parent final review 会读取 child run state 中的 `runSpecCoding`、`specRevisionVoteHistory` 和 `deltaMergeState`，写入结构化 `childSpecDeltas`：

- child workflow / run / parent step 来源。
- SpecCoding 状态、版本、进度摘要。
- 完成任务数 / 总任务数。
- 非空 artifact keys。
- 最新 revision、最新 revision vote、delta merge 状态。

## 引用重命名

删除 child workflow 时会阻止误删已被引用的配置。重命名 workflow 后，如果保存请求提供 `renameFrom` 或 `previousFilename`，系统会自动更新当前用户可访问的 parent workflow 中的 subworkflow 引用。

## 快照行为

root run 启动时会把 parent 和 dependency graph 内的 child YAML 写入 `runs/<runId>/configs/`，并生成 `manifest.json`：

- `manifestHash` 记录依赖图完整性。
- 每个 config 记录 `sha256`。
- child 运行读取 snapshot，不读取实时 YAML。
- snapshot manifest 或 config 内容被篡改时，读取会失败并要求重新启动或恢复 run snapshot。

## 限制

- child workflow 必须是 state-machine。
- child config 必须使用相对 YAML 路径，禁止绝对路径和 `..`。
- 默认最大嵌套深度为 3，系统上限为 8。
- 默认 dependency graph 最大 32 个配置。
- 默认 snapshot 总大小上限为 2 MiB。
- 单个 parent 默认最多保留 8 个 active child runs。
- 单个用户跨运行默认最多保留 16 个 active child runs。
- 单个 root run 默认最多记录 64 个 child runs。
- 单个并发组默认最多 8 个 subworkflow 分支。
- 单个 child run 默认最多接收 500 条 parent 侧状态/等待事件。
- parent 侧 child summary 默认最多保留 16 KiB，超过后截断并标记。
- parent run 会记录轻量 subworkflow audit trail，包括 start、waiting-human、human-answer、force-complete-child、rerun-supersede 和 result-mapping。
