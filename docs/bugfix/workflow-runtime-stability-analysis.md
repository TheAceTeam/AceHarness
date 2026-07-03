# 工作流运行稳定性与性能问题分析

## 范围

本文记录当前工作流运行、定时任务、状态机运行页面、配置列表接口和构建架构相关的已知问题。目标是把用户侧症状拆成可定位的代码风险、可能根因和修复方向，便于后续按优先级修复。

本文基于当前代码静态分析，未覆盖线上日志与完整复现数据；带有“待验证”的结论需要结合用户机器日志确认。

## 1. 全局 npm 安装后定时任务不可用

### 现象

- 用户通过 `npm install -g @cangjielang/aceharness` 安装后，页面上能创建定时任务，但到点不执行。
- 手动触发定时任务可能失败，或提示工作流启动接口不可用。
- 本地开发环境可用，用户电脑的全局安装环境不可用。
- 启动日志出现：`Scheduler restore failed: Error: Failed to load external module node-cron-xxx`。

### 代码路径

- CLI 入口：`bin/ace.js`
  - 设置 `ACE_INSTALL_ROOT` 后加载 `dist/cli.js`。
- 自定义服务器：`server.js`
  - 启动 Next 自定义 server。
  - `process.chdir(__dirname)` 会把当前工作目录切到安装目录。
  - 监听地址默认是 `ACE_HOST || 127.0.0.1`，端口默认是 `PORT || ACE_PORT || 3000`。
- 调度器：`src/lib/core/scheduler.ts`
  - 单例 `scheduler` 维护内存中的 cron task。
  - 持久化到 `getWorkspaceDataFile('schedules.yaml')`。
  - 到点后通过 `fetch(${internalBaseUrl}/api/workflow/start)` 自调用 HTTP 接口启动工作流。
- Next 配置：`next.config.js`
  - `serverExternalPackages` 曾包含 `node-cron`，生产构建会把它作为外部模块处理。
- CLI dist 构建：`scripts/build-cli.js`
  - entry 列表曾未包含 `src/lib/core/scheduler.ts`。
- 初始化：`src/lib/core/instrumentation-nodejs.ts`
  - `runNodejsInstrumentation()` 里调用 `scheduler.init()`。
- API：
  - `src/app/api/schedules/route.ts`
  - `src/app/api/schedules/[id]/trigger/route.ts`

### 可能根因

1. 调度器依赖 Next instrumentation 恢复，生产自定义 server 下初始化时机不够强约束。
   - `scheduler.init()` 主要在 `instrumentation-nodejs.ts` 和 schedules API 请求里触发。
   - 如果用户启动后不访问定时任务 API，或 instrumentation 在某些打包/运行路径没有按预期执行，cron task 可能没有恢复。

2. `node-cron` 被 Next 作为 server external 处理，全局安装包运行时可能找不到外部模块。
   - `next.config.js` 的 `serverExternalPackages` 包含 `node-cron` 时，生产 server chunk 不会把该依赖打进相关包内。
   - 全局 npm 安装后的执行目录、包裁剪、Next trace 产物和依赖提升方式不稳定，可能导致 instrumentation 恢复 scheduler 时加载 `node-cron` 失败。
   - 这个问题与用户提供的 `Scheduler restore failed: Error: Failed to load external module node-cron-xxx` 直接匹配。

3. CLI dist 构建未显式包含 scheduler。
   - `scripts/build-cli.js` 只从 entryFiles 递归收集本地 TS 依赖。
   - 旧 entry 列表没有 `src/lib/core/scheduler.ts`，导致 `dist/lib/core/scheduler.js` 缺失。
   - 一旦 CLI 或自定义 server 某条路径从 `dist` 恢复调度器，就会缺模块。

4. 到点执行走 HTTP 自调用，baseUrl 推断容易和实际服务不一致。
   - `_getInternalBaseUrl()` 使用 `ACE_INTERNAL_BASE_URL`、`NEXT_PUBLIC_APP_URL`，否则拼 `127.0.0.1:${PORT || ACE_PORT || 3000}`。
   - 如果用户实际用非默认端口、反向代理子路径、不同 host，或服务只监听特定地址，自调用可能打到错误地址。
   - 手动触发使用 `req.nextUrl.origin`，比自动到点执行更可靠，这会造成“手动可以、到点不行”的差异。

5. 全局安装后的运行目录与用户数据目录分离，排障时容易误判配置位置。
   - `server.js` 会 `chdir` 到安装目录。
   - `app-paths.ts` 中运行时数据默认放在 `ACE_HOME`、Windows `%APPDATA%/ACEHarness` 或 `~/.aceharness`。
   - 用户如果在项目目录里找 `data/schedules.yaml`，会看不到真正的调度配置。

6. 定时任务只存在于当前 Node 进程内，没有独立 daemon 或外部调度器兜底。
   - 进程退出、内存看门狗重启、用户关闭终端后，cron 不会在系统层继续存在。
   - 重启后只有 `scheduler.init()` 成功执行才会恢复。

### 修复方向

- 在 `server.js` 的 `app.prepare().then(...)` 成功后显式导入并执行 `scheduler.init()`，不要只依赖 Next instrumentation 或用户访问 schedules API。
- 从 `next.config.js` 的 `serverExternalPackages` 移除 `node-cron`，让 Next 生产构建自行打包该依赖。
- 把 `src/lib/core/scheduler.ts`、`schedule-validation.ts`、`user-store.ts` 纳入 `scripts/build-cli.js` 的 dist entry，避免全局安装产物缺调度器模块。
- 自动定时执行不要通过 HTTP 自调用。优先抽出 `startWorkflow(configFile, user)` 服务层，API 路由和 scheduler 共用同一个 Node 函数。
- 如果保留 HTTP 自调用，启动 server 后写入明确的 `ACE_INTERNAL_BASE_URL` 运行时值，并支持 `BASEURL/BASE_PATH`。
- 定时任务页面增加运行诊断：当前进程是否已加载 cron、下一次执行时间、最近一次错误、实际数据目录、内部启动 URL。
- 全局安装模式建议配套 `ace service start/status/stop` 或系统服务安装，让定时任务有受管后台进程。

## 2. 状态机运行页面极为卡顿

### 现象

- 状态机工作流运行页面在执行中非常卡。
- 状态机步骤数、并发分支、子工作流、实时输出和历史事件越多越明显。
- 不是“工作流管理页面首屏慢”，而是 `/workbench/[config]` 的运行视图在运行态更新时卡顿。

### 代码路径

- 状态机运行页：`src/app/workbench/[config]/WorkbenchClient.tsx`
  - `fetchCurrentStatus()` 调用 `workflowApi.getStatus(configFile, runId)`。
  - `workflowApi.connectStatusStream(...)` 订阅 `/api/workflow/status?live=1`。
  - `applyWorkflowStatusSnapshot(...)` 会把 status 中的 `stepLogs`、`stateHistory`、`supervisorFlow`、`agentFlow` 等数组写入多个 React state。
  - 实时输出面板维护 `liveStream`，渲染时多次调用 `parseChunk()`、`prepareChunkForDisplay()`、`AceAwareMarkdown`。
  - 页面同时渲染 `StateMachineExecutionView`、`FlowDiagram`、`AgentFormationDiagram`、详情面板、实时面板等重组件。
- 运行状态 API：`src/lib/core/api.ts`
  - `connectStatusStream()` 每次 SSE status 事件都把完整 `WorkflowStatusResponse` 传给页面。
  - SSE 失败后 fallback 到 `startPolling()`，每 5 秒拉一次完整 status。
- 状态机运行时：`src/lib/state-machine/workflow-manager.ts`
  - `getStatus()` 返回运行态大对象，包括状态历史、流转记录、Agent 流、step logs、质量检查、子工作流信息等。

### 根因

状态机运行页把“运行态快照”当成频繁更新的 UI state 使用。随着工作流运行时间增长，status payload 会越来越大，而前端每次收到 status 都可能触发大范围 setState、重算和重渲染。

主要风险点：

1. 状态快照过大。
   - `stepLogs` 可能包含较大的 output/error。
   - `stateHistory`、`supervisorFlow`、`agentFlow` 会随状态机运行线性增长。
   - 子工作流状态也会被合并到页面状态中。

2. status 更新频率高且粒度粗。
   - SSE 每次推完整 status，而不是增量事件。
   - fallback polling 也是完整 snapshot。
   - 小变化会导致整页多个区域更新。

3. 图形组件重算成本高。
   - `FlowDiagram`、`AgentFormationDiagram`、状态机执行视图依赖当前步骤、active steps、历史流转、Agent 状态。
   - 大数组引用每次变化都会破坏 memo 命中，触发图节点/边重建和布局重算。

4. 实时输出渲染成本高。
   - `liveStream` 以 chunk 数组存在，渲染时过滤、分组、解析、Markdown 渲染。
   - 页面内联实时面板和全屏弹窗存在相似渲染逻辑，容易重复计算。
   - 大 tool result 或 Markdown 代码块会放大 `AceAwareMarkdown` 成本。

5. 多个状态源互相放大。
   - 页面同时维护 `workflowStatus`、`persistedStepLogs`、`smStateHistory`、`supervisorFlow`、`agentFlow`、`liveStream` 等状态。
   - 一个 status 事件会拆成多次 setState，React 需要协调多个重组件更新。

### 修复方向

- status API 拆分为轻量实时状态和重详情：
  - 轻量 status 只返回 `status`、`runId`、`currentState/currentStep`、`activeSteps`、计数、最近事件 seq。
  - `stepLogs`、`stateHistory`、`agentFlow`、`supervisorFlow` 改为按需分页或增量读取。
- SSE 改成增量事件：
  - 用 `/api/workflow/event-log?afterSeq=&limit=` 或等价事件流驱动 UI。
  - 前端本地 append 事件，而不是每次替换完整数组。
- 对运行页做视图级懒加载：
  - 默认只渲染当前运行摘要和当前步骤。
  - 流程图、Agent 流、历史详情、子工作流详情在 tab 激活或展开时再渲染。
- 对重组件加稳定输入和 memo：
  - 只把图组件需要的最小字段传入。
  - 避免每个 status tick 创建新的大数组对象。
  - 图布局结果按 workflow config + active keys 缓存。
- 实时输出面板做真正虚拟化和增量解析：
  - chunk 入库时解析一次，render 阶段只渲染可见项。
  - 大 tool result 和长 Markdown 块先折叠，展开后再渲染。
- 合并 status 更新：
  - `applyWorkflowStatusSnapshot()` 内部先比较字段版本或 hash，只对变化字段 setState。
  - 对高频字段使用节流，例如 250-500ms 合并一次 UI 更新。

## 3. 配置列表接口需要读取分页

### 现象

- 工作流列表 API 虽然有 `page/pageSize`，但服务端仍会读取并解析所有配置文件。
- 配置数量多时，任何调用 `/api/configs?page=1&pageSize=20` 的页面都会变慢。
- 这个问题独立于“状态机运行页面卡顿”，但也必须修。

### 代码路径

- 前端页面：`src/app/workflows/page.tsx`
  - `loadWorkflows()` 调用 `configApi.listConfigs({ page, pageSize, keyword, mode, sortKey, sortDirection })`。
- 工作流列表 API：`src/app/api/configs/route.ts`
  - `ensureRuntimeConfigsSeeded()`。
  - 扫描配置目录及一级子目录。
  - 对所有 YAML 文件执行 `readFile()` + `parse()`。
  - 对每个配置读取 meta、owner、`stat()`。
  - 过滤、排序后才调用 `paginate()`。

### 根因

当前分页是“返回分页”，不是“读取分页”。即使请求第一页 20 条，服务端也会先把所有可访问 YAML 全量读入、解析、统计，再截取当前页。

另外，`/api/configs` 为每个配置逐个查 owner：

- `meta.createdBy ? await getUserById(meta.createdBy) : undefined`

这在循环中串行执行，容易放大文件系统读取成本。

### 修复方向

- 短期修复：先建立候选文件元信息列表，再分页读取。
  - 第一遍只拿 filename、meta.createdAt、stat.birthtimeMs 这类轻量信息。
  - 如果 `sortKey=createdAt` 且没有 `keyword/mode` 过滤，可以先排序分页，再只解析当前页 YAML。
  - 如果存在 `keyword/mode`，没有索引时仍可能需要解析较多文件，应记录为慢路径。
- 正式修复：维护轻量索引，例如 `workflow-config-index.json` 或 SQLite 表。
  - 保存 filename、name、description、mode、stepCount、createdAt、visibility、ownerName。
  - 保存、导入、删除配置时增量更新索引。
  - 列表接口只读索引、过滤、排序、分页；详情页再读完整 YAML。
- owner 信息批量读取用户表一次，不要在配置循环里逐个 `getUserById()`。
- `ensureRuntimeConfigsSeeded()` 加启动期或版本级缓存，避免每次列表请求都做种子检查。

## 4. 工作流经常出现“引擎异常，已停止工作流”

### 现象

- 工作流运行中突然停止，页面显示引擎异常或工作流失败。
- 多 Agent、状态机、长上下文或非 Claude 引擎更容易出现。
- 失败后经常需要手动恢复或重新运行。

### 代码路径

- 阶段式工作流：`src/lib/workflow/manager.ts`
  - `runStep()`
  - `executeEngineWithContextRecovery(...)`
  - `lastStepSucceeded()`
  - 顶层 `start()` / `resume()` catch 后 `finalizeRun('failed')`
- 状态机工作流：`src/lib/state-machine/workflow-manager.ts`
  - `executeWithEngine(...)`
  - `executeEngineWithContextRecovery(...)`
  - `isEngineLevelFailure(message)`
  - `STEP_AUTO_RECOVERY_MAX_ATTEMPTS = 3`
  - 顶层 catch 后 `finalizeRun('failed')`
- 引擎包装层：
  - `src/lib/engines/acp-engine.ts`
  - `src/lib/engines/acp-wrapper-base.ts`
  - `src/lib/engines/context-recovery.ts`

### 可能根因

1. 引擎级错误分类偏激进。
   - 状态机的 `isEngineLevelFailure()` 会把 ACP 连接关闭、401/403、上下文超限、网络错误、进程流创建失败等直接归为引擎级错误。
   - 一旦被归为引擎级错误，很多路径会跳过普通步骤自动恢复，直接让 run failed。

2. ACP 引擎复用和进程生命周期存在脆弱点。
   - `acp-wrapper-base.ts` 复用内部 `ACPEngine`，依赖 `isEngineAlive()` 判断进程存在。
   - 进程存在不代表协议会话健康；session、stdin/stdout、模型状态、可用命令都可能已经失效。
   - 退出和 error 事件会清理 engine，但运行中的调用可能仍收到“连接关闭/未初始化”。

3. 长上下文恢复能力和工作流步骤失败策略没有充分解耦。
   - `context-recovery.ts` 能处理部分上下文窗口问题，但如果 compact 失败或恢复后的 session 不可用，错误会继续向上冒泡。
   - 对用户来说，某个 Agent 的一次引擎故障会表现为整个工作流停止。

4. 状态机有自动恢复，但恢复范围偏向“步骤执行错误”，对引擎级错误保守失败。
   - 这能避免无意义重试，但也会把临时网络、ACP 子进程抖动、模型服务短时不可用直接升级成工作流终止。

### 修复方向

- 引入“引擎异常降级策略”：
  - 临时网络、ACP 连接关闭、子进程意外退出：先重建 engine/session 并重试当前步骤。
  - 鉴权失败、模型不存在、明确配置错误：快速失败并给出可操作诊断。
  - 上下文超限：优先 compact / summary / 新会话续跑，再失败。
- 在 step 级别保存更细的 failure kind：`engine-transient`、`engine-config`、`context-limit`、`tool-failure`、`task-failure`。
- 工作流不要因为单次 transient engine failure 直接 `finalizeRun('failed')`；应进入 `waiting-recovery` 或 `stopped-recoverable`，允许一键恢复。
- ACP wrapper 增加 health check：发送 prompt 前确认 session 可用、命令列表可用、进程未退出；失败则重建。
- UI 上把“引擎异常已停止工作流”改为具体原因和下一步动作，例如“OpenCode ACP 连接断开，已保存当前步骤，可重试当前步骤”。

## 5. 强制跳转后旧运行态仍可能写回

### 现象

- 强制跳转后页面可能显示两个活跃步骤。
- 旧步骤可能继续写日志或状态。
- 流程图高亮可能同时显示旧步骤和目标步骤。

### 代码路径

- 前端：`src/app/workbench/[config]/WorkbenchClient.tsx`
  - `executeForceTransition()`
  - 发起 `workflowApi.forceTransition(...)` 后立即 `fetchCurrentStatus()`。
- 后端：`src/lib/state-machine/workflow-manager.ts`
  - `forceTransition(targetState, instruction, actor)`
  - 设置 `pendingForceTransition`
  - 调用 `cancelCurrentProcesses()`

### 根因

强制跳转是异步协作式停止。旧步骤只有在执行流检查到 pending transition 后才会停止；如果旧进程继续输出、完成清理或调用 `persistState()`，可能覆盖新状态。

### 修复方向

- 前端增加强制跳转 pending 状态，直到收到 transition-complete/status 事件才解锁。
- 后端在请求强制跳转时立即进入 transition guard。
- 立即清理 `activeStepKeys`、`currentStep`、`activeConcurrencyGroups` 和旧 process refs。
- 为运行状态增加 generation/version，旧步骤完成时如果 generation 不匹配，不允许写 active runtime state。

## 6. Dashboard Dock 工作流标签漂移

### 现象

- 多个 workbench 标签会跳转或互相影响。
- 点击历史、运行、设计导航时偶尔进入错误视图。
- URL 参数变化后 dock 窗口像是被重新打开。

### 代码路径

- `src/components/dashboard/DashboardPageShell.tsx`
  - `buildDockTabForRoute()`
  - `activeEmbeddedRoute` effects 调用 `openTab()`。
- `src/components/dashboard/DashboardDockWorkspace.tsx`
  - `openTab()`
  - `updateActiveWorkbenchSearch()`
- `src/app/workbench/[config]/WorkbenchClient.tsx`
  - `updateUrl()`

### 根因

Workbench tab identity 过于易变。`mode`、`runId`、`history`、`designTab` 是视图参数，但部分参数也参与了 dock panel identity。外层 dashboard 和内层 workbench 又同时更新 URL/search，导致路由变化可能创建或激活另一个 panel。

### 修复方向

- Workbench dock tab identity 稳定为 `config` 加可选 run scope。
- `mode`、`runId`、`history`、`designTab` 作为 mutable params/search。
- 统一 `run` 与 `runId`。
- 如果当前 active tab 已经是同一个逻辑 workbench，外层不要再次 openTab。

## 7. 实时流渲染泄漏协议标签并造成卡顿

### 现象

- `<step-conclusion>` 等协议标签可能在实时输出中裸露。
- 大量实时输出会让页面变卡。
- 大型 tool result 或 markdown chunk 可能拖慢渲染。

### 代码路径

- `src/app/workbench/[config]/WorkbenchClient.tsx`
  - `prepareChunkForDisplay()`
  - `sanitizeProtocolBlocksForDisplay()`
  - `parseChunk()`
  - 实时流面板反复将 visible chunks 渲染成 `AceAwareMarkdown`。
- `src/lib/run/output-compaction.ts`
  - `compactRuntimeOutputPreview()` 只压缩 step log preview，不压缩实时 stream 内容。

### 根因

协议标签清理发生在 UI 侧且按 chunk 局部处理。如果标签跨 chunk，或者另一个 panel 没有走 `prepareChunkForDisplay()`，标签就会泄漏。同时实时面板在 render 阶段做 parse/filter/merge/markdown 渲染，输出多时会重复计算。

### 修复方向

- 写入 stream 前剥离或解释协议块。
- 实现跨 chunk 的 streaming-safe protocol parser。
- 增量维护 parsed items，避免 render 时重复 parse。
- 实时输出列表虚拟化。
- 对 stream 级别的大型 tool result 做压缩，不只压缩 stepLog preview。

## 8. 步骤交接和状态流转慢

### 现象

- 多 Agent、多步骤工作流在非 Claude 引擎下交接很慢。
- 步骤越多，额外等待越明显。
- 状态机从一个状态流转到下一个状态也明显慢，即使当前状态的最后一步已经完成，页面仍会停在“审阅/流转/准备下一状态”的体感等待中。

### 代码路径

- `src/lib/state-machine/workflow-manager.ts`
  - 状态步骤 segment 执行后存在非 Claude 固定等待：
    - `getLogicalEngineId(this.engineType) !== 'claude-code'`
    - `setTimeout(..., 30000)`

### 已确认原因

1. 非 Claude 引擎存在固定 30 秒 segment delay。
   - `executeState()` 中每执行过一个 segment 后，如果还有后续 segment 且 `getLogicalEngineId(this.engineType) !== 'claude-code'`，会 `await setTimeout(30000)`。
   - 这里的 segment 不只等于“状态”，也包括状态内的串行 step 或并发 step group。
   - 一个状态里有 5 个串行步骤时，非 Claude 引擎最多会额外等待 4 * 30 秒。

2. 状态完成后会同步执行 Supervisor 阶段审阅。
   - `executeStateMachine()` 在 `executeState()` 和 `evaluateTransitions()` 后调用：
     - `await this.collectSupervisorReview('state-review', stateConfig, result, config, nextState);`
   - `collectSupervisorReview()` 会调用 `queryAgent()`，也就是再跑一次 Supervisor 模型请求。
   - 这个请求完成前，不会进入下一状态。

3. 需要人工审批时会再跑一次 checkpoint advice。
   - 如果 `stateConfig.requireHumanApproval` 为真，状态流转前会调用：
     - `await this.collectSupervisorReview('checkpoint-advice', stateConfig, result, config, nextState);`
   - 这意味着一个状态结束可能有两次 Supervisor 模型调用：`state-review` + `checkpoint-advice`。

4. Supervisor 审阅 prompt 会额外读取历史经验和 CHECKLIST。
   - `collectSupervisorReview()` 中会读取：
     - `findRelevantWorkflowExperiences(...)`
     - repository 持久化模式下的 `readChecklist(...)`
   - 这些虽然不是模型调用，但会增加状态流转前的同步 I/O。

5. SpecCoding 状态更新会触发多次持久化。
   - 状态开始时，如果存在 `currentRunSpecCoding`，会 `markSpecCodingStateStatus(... in-progress)` 后 `persistState()`。
   - 状态完成后会再次 `markSpecCodingStateStatus(...)` 并 `persistState()`。
   - Supervisor 审阅后还会 `appendSupervisorSpecCodingRevision(...)` 并 `persistState()`。
   - `persistState()` 会保存包含 `stepLogs`、`stateHistory`、`supervisorFlow`、`agentFlow`、SpecCoding details 等的大对象；运行越久，写入越重。

6. 状态流转事件会放大前端卡顿。
   - 每次 `transition`、`state-change`、`supervisor-review`、`agent-flow` 后，前端运行页可能收到完整 status snapshot。
   - 状态流转本身即使后端只花几秒，前端如果同时重渲染流程图、Agent 图、实时输出和详情面板，也会体感“卡住”。

7. 自动上下文压缩会插入额外模型调用。
   - `autoCompactAgentContextIfNeeded()` 在 `autoCompactOnStepChange` 开启、且 agent 已有历史 step log 和 session 时，会在步骤切换前调用 `compactEngineContextManually(...)`。
   - 这对长工作流有帮助，但会让步骤交接多一次压缩调用。

8. Spec 修订表决可能与后续执行争用同一个 engine lock。
   - 状态完成时如果 `enableSpecRevisionOnComplete === true`，会 `queueSpecRevisionVote(...)`。
   - 表决在 `specRevisionVoteTail` 中串行执行，会调用多个 Agent 和 Supervisor。
   - 代码中 engine 执行由 `withEngineExecutionLock` 串行化；即使表决是队列任务，也可能与后续普通步骤竞争同一个引擎实例，造成下一状态启动变慢。

9. 状态流转缺少“快速路径”。
   - 自动转移场景理论上只需要：解析 verdict -> 匹配 transition -> 更新 currentState。
   - 当前路径还串联了审阅、聊天事件、SpecCoding 修订、持久化、状态推送、图流转记录等附加工作。
   - 这些能力都有价值，但不应全部阻塞“进入下一状态”。

### 修复方向

- 把固定 30 秒 delay 改成可配置节流，默认关闭或降到 1-3 秒。
- 仅在 rate limit、ACP 会话未就绪、模型服务明确要求等待时启用 adaptive backoff。
- 把 Supervisor 阶段审阅改成可选异步：
  - 默认不阻塞自动状态流转。
  - 审阅结果作为下一状态上下文补充或侧边栏事件，而不是阻塞进入下一状态。
- `checkpoint-advice` 只在确实需要人工审批时执行，并允许配置关闭。
- `state-review` 与 `checkpoint-advice` 合并：
  - 如果同一个状态刚做过 state review，人工审批前不要再跑一次完整 Supervisor 调用。
  - 可以复用 state review 摘要生成短 checkpoint advice。
- `persistState()` 做轻重分层：
  - 状态切换路径只写轻量 runtime state。
  - 大字段如完整 `stepLogs`、SpecCoding details、agentFlow/supervisorFlow 增量写或异步写。
- Spec 修订表决不应抢占主执行链：
  - 使用独立 engine instance 或低优先级队列。
  - 不要与下一状态第一个步骤共享同一个 execution lock。
- 自动上下文压缩只在达到阈值时触发：
  - 根据 token 估计、step log 数量、上下文错误信号触发。
  - 不要每次 step change 都默认压缩。
- UI/日志中展示“交接耗时分解”：
  - segment delay、Supervisor review、checkpoint advice、persistState、Spec vote、engine init/compact 分别计时。
  - 这样能定位真实慢点，而不是只看到“下一步迟迟没开始”。

## 9. 协作 Agent 成员窗口显示不全

### 现象

- 在工作流协作/Agora 区域打开 Agent 成员窗口时，窗口底部显示不全。
- 成员列表虽然内部有滚动区域，但外层浮窗高度、层级或裁切关系不稳定，底部可能被输入区、页面边界或父容器遮住。
- 截图中 `当前成员` 列表只露出部分内容，底部滚动条和列表末尾区域被截断。

### 代码路径

- 协作面板：`src/components/collaboration/AgoraShell.tsx`
  - Agent 面板使用 `aside`。
  - `fixedGuestPanel` 时 class 为：
    - 收起：`fixed right-6 top-[8.5rem] z-40`
    - 展开：`fixed bottom-6 right-6 top-[8.5rem] z-40`
  - 外层 class 包含 `overflow-hidden`。
- 成员列表：`src/components/ui/stacked-list.tsx`
  - 根容器：`flex h-full min-h-0 ... overflow-hidden`。
  - 当前成员列表：`min-h-0 flex-1 overflow-y-auto px-4 pb-20`。
  - 底部成员目录层：`absolute z-50 ... overflow-hidden`，展开时 `height: calc(100% - 16px)`。
- 嵌入场景：
  - `src/app/workbench/[config]/WorkbenchClient.tsx`
  - 运行页大量容器使用 `overflow-hidden`，右侧运行详情、实时输出和协作面板都在同一高密度布局中。

### 根因

Agent 成员面板是 fixed/absolute 混合布局，且多层容器都设置了 `overflow-hidden`。在 workbench 运行页中，底部还有输入框/协作发言区，面板没有统一按可视区扣除底部安全距离和 composer 高度，导致展开后的 `StackedList` 虽然内部可滚动，但整体浮窗仍可能超出可视区域或被更高层 UI 遮住。

另外，`AgoraShell` 的面板层级是 `z-40`，而运行页里多个弹层、浮动条、底部 banner、Dialog 使用 `z-50` 或更高。成员面板在复杂布局下可能被同级或更高层元素盖住。

### 修复方向

- 给 fixed Agent 面板设置明确 viewport 高度约束：
  - 展开态建议使用 `max-h: calc(100dvh - topOffset - bottomOffset)`。
  - bottomOffset 需要覆盖底部输入区、floating banner 和安全区，例如 `bottom-24` 或 CSS var。
- 面板主体改成稳定的 flex 滚动结构：
  - 外层不裁切内容，或只裁切圆角背景。
  - 列表主体负责 `overflow-y-auto`。
  - `StackedList` 底部成员目录展开时不应把当前成员滚动区完全盖住。
- 提高固定面板层级：
  - 从 `z-40` 提到与应用浮层一致的层级，例如 `z-[80]`。
  - 如果需要覆盖在 workbench 右侧栏和 composer 之上，应使用 portal 到 `document.body`，避免受父容器 stacking context 影响。
- 窄高度场景下提供全屏/抽屉模式：
  - 当 viewport 高度不足时，Agent 成员窗口切换为 Sheet/Dialog。
  - 或点击面板右上角图标展开到更高层全屏侧栏。
- 增加视觉回归检查：
  - 在 900x900、1366x768、移动窄屏等高度下截图确认成员列表底部、滚动条、输入区不互相遮挡。

## 10. 工作流文档 Tab 加载慢

### 现象

- 工作流文档页签加载慢。
- 有 child workflows 或大量 output 文件时更明显。

### 代码路径

- `src/components/DocumentsPanel.tsx`
  - `loadFiles()` 总是调用 `runsApi.listDocuments(runId, { includeChildren: true })`。
- `src/app/api/runs/[id]/documents/route.ts`
  - 读取 run state。
  - 读取 workflow config 构建 step metadata。
  - 扫描 `runs/<runId>/outputs`。
  - 扫描 workspace `.ace-outputs/<runId>`。
  - `includeChildren=1` 时递归扫描 child runs。
  - 对每个文件执行 stat。

### 根因

文档加载是 eager、recursive、uncached。每次 panel mount 都全量扫目录和解析 metadata。

### 修复方向

- 先加载 root run 文档。
- child run 文档在展开时懒加载。
- workflow config step metadata 做缓存。
- 增加分页或 initial limit。
- 文档 tab 未激活时不加载文档。

## 11. 是否迁移到 Nitro + Vite

### 判断

迁移到 Nitro + Vite 有机会明显提升开发启动、HMR、前端编译和 API server 打包性能，但它不是一个“小改构建工具”的任务。当前项目深度依赖 Next App Router、Route Handlers、`next/navigation`、`next-themes`、Next instrumentation、自定义 server 和 Next 构建产物发布。直接全量替换会触碰大部分页面和 API。

### 当前 Next 相关耦合

- 页面目录：`src/app/**/page.tsx`
- API 路由：`src/app/api/**/route.ts`
- 路由能力：
  - `next/navigation`
  - `Link` from `next/link`
  - App Router 动态路由，例如 `src/app/workbench/[config]/page.tsx`
- 运行时：
  - `src/instrumentation.ts`
  - `src/lib/core/instrumentation-nodejs.ts`
  - `server.js` 使用 `next({ dev, hostname, port })`
- 打包发布：
  - `package.json` `files` 明确包含 `.next/**`
  - `scripts.build` 使用 `next build`

### Nitro + Vite 的潜在收益

- Vite dev server 和 HMR 通常比 Next App Router 当前路径更轻。
- Nitro server routes 可把 API 侧构建成独立 Node server，冷启动和部署产物更可控。
- 前端和后端边界更清楚，便于把 workflow runtime、scheduler、engine manager 变成独立服务层。
- 可以摆脱 `.next` 构建产物发布的复杂度，减少全局 npm 包体和运行时路径问题。

### 迁移风险

- 需要替换所有 Next API route 的 request/response 适配。
- 需要替换 `next/navigation`、`next/link`、App Router layout/page 约定。
- Auth middleware、instrumentation、basePath、静态资源路径、自定义 server、WebSocket 协作服务都要重接。
- 当前测试和组件可能假设 Next route shape，需要重写 route helpers。
- 如果一次性迁移，容易和工作流稳定性修复互相干扰。

### 建议路线

不要直接“一步切到 Nitro + Vite”。建议按服务边界拆：

1. 先把 workflow runtime、scheduler、engine manager 从 Next route 中抽成纯服务层。
   - 修复定时任务 HTTP 自调用问题。
   - 让 API route 只是薄适配层。

2. 新建 Nitro server 作为 API 兼容层试点。
   - 先迁移低风险 API，例如 `/api/schedules`、`/api/configs`、`/api/run-history`。
   - 保持响应 JSON shape 不变。

3. 前端先用 Vite 构建 dashboard/workflows/workbench 的纯 React 入口。
   - 把 Next page wrapper 变薄，核心 UI 迁到 router-agnostic 组件。
   - 替换 `next/navigation` 为应用内导航适配器。

4. 完成 API 与前端路由适配后，再移除 Next 自定义 server 和 `.next` 发布产物。

### 推荐优先级

短期优先修稳定性和首屏性能，不应先做全量框架迁移：

1. 定时任务全局安装不可用。
2. 引擎异常导致工作流停止。
3. 状态机运行页面卡顿。
4. 配置列表接口读取分页。
5. 强制跳转旧状态写回。
6. 实时流渲染性能。
7. Nitro + Vite 分阶段迁移。

原因是前三项可以在当前架构内快速收益；Nitro + Vite 是中长期架构收益，最好建立在服务层已抽离之后。
