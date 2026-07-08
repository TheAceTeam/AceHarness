# TanStack Start 完全替换与性能优化计划

## 范围

本文替代原有“工作流运行稳定性与性能问题分析”。旧文档中的 1-10 个独立问题不再单独保留，统一纳入 TanStack Start 迁移和性能治理计划。

目标是用 TanStack Start 完全替换 Next.js 作为应用框架，并同时完成以下优化：

- 前端路由、页面加载和 search params 状态改为 TanStack Router。
- 请求、缓存、分页、重试、后台刷新和按钮 loading 改为 TanStack Query。
- 大列表、运行历史、实时日志、文档和状态机历史改为 TanStack Virtual。
- 本地响应式集合、派生视图和乐观更新改为 TanStack DB。
- AI streaming、tool-call 展示和 agent 消息状态改为 TanStack AI。
- 生产构建、全局 npm 启动、scheduler restore、WebSocket、base path 和 CLI 发布链路从 Next 迁出。

## 总体决策

迁移路线是激进完全替换，不做长期双栈：

- 用 TanStack Start 替换 Next App Router、Next Route Handlers、Next custom server 和 `.next` 发布产物。
- 用 Vite 构建前端和 Start 应用，不再以 `next build` 作为生产构建。
- 保留现有 API URL、JSON shape、认证行为、数据目录和用户数据格式。
- 迁移完成后 `ace start` 启动 TanStack Start 生产 server，而不是 `server.js` + Next。
- TanStack DB 和 TanStack AI 纳入正式计划，不只是后续评估项。

## 目标技术栈

| 层级 | 目标 |
| --- | --- |
| 应用框架 | TanStack Start |
| 路由 | TanStack Router |
| 请求状态 | TanStack Query |
| 大列表渲染 | TanStack Virtual |
| 本地响应式数据 | TanStack DB |
| AI 交互层 | TanStack AI |
| 构建 | Vite |
| 运行入口 | `ace start` -> Start production server |
| 后端服务 | Start server routes/functions + 现有服务层 |
| 实时能力 | 保留 SSE 和 WebSocket，但从 Next custom server 迁到 Start/Node bootstrap |

## 必须替换的 Next 耦合

- 页面系统：
  - `src/app/**/page.tsx`
  - `src/app/**/layout.tsx`
  - `src/app/workbench/[config]/page.tsx`
  - `src/app/[...filePath]/page.tsx`
- API 路由：
  - `src/app/api/**/route.ts`
  - `NextRequest`
  - `NextResponse`
  - `request.nextUrl`
- 路由和导航：
  - `next/navigation`
  - `next/link`
  - App Router dynamic segment 和 search params 语义
- 运行时：
  - `src/instrumentation.ts`
  - `src/lib/core/instrumentation-nodejs.ts`
  - `server.js` 中的 `next(...)`
  - `app.getRequestHandler()`
  - `app.getUpgradeHandler()`
- 构建发布：
  - `next build`
  - `.next/**`
  - `.next/BUILD_ID`
  - Next trace / server external 策略

## 目录重组

目标目录：

```text
src/
  start/
    router.tsx
    routeTree.gen.ts
    routes/
      __root.tsx
      index.tsx
      dashboard.tsx
      workbench.$config.tsx
      api/
  features/
    workflow/
    configs/
    documents/
    ai/
  client/
    query/
    db/
    virtual/
    ai/
  server/
    services/
    bootstrap/
    websocket/
  shared/
    api-contracts/
    routes/
    runtime/
```

迁移原则：

- `src/app/**/page.tsx` 迁到 `src/start/routes/**` 或 feature route wrapper。
- `src/app/api/**/route.ts` 迁到 Start server routes/functions。
- `src/components/**` 尽量保留，但清理 `next/navigation`、`next/link`、`next/dynamic` 等耦合。
- workflow runtime、scheduler、engine manager 抽到 `src/server/services/**`，API route 只做薄适配。
- 共享类型和 API contract 放到 `src/shared/**`，供前端、server routes 和测试共用。

## 路由迁移

TanStack Router 必须覆盖当前用户可访问页面：

- `/`
- `/login`
- `/login/reset`
- `/register`
- `/setup`
- `/dashboard`
- `/workbench/:config`
- `/workflows`
- `/run-history`
- `/agents`
- `/schedules`
- `/models`
- `/engines`
- `/skills`
- `/marketplace`
- `/knowledge`
- `/knowledge/library`
- `/notebook`
- `/office`
- `/users`
- `/account`
- `/account/system-settings`
- `/account/channels`
- `/api-docs`
- `/[...filePath]`

必须兼容现有 dashboard 嵌套路由：

- `/dashboard?route=/workbench/<config>?mode=history`
- `/dashboard?route=/workbench/<config>?mode=run`
- `/workbench/<config>?mode=history`
- `/workbench/<config>?mode=run`

search params 要从字符串散落改成 route 级 schema：

- `mode`
- `runId`
- `history`
- `designTab`
- `route`
- `page`
- `pageSize`
- `keyword`
- `mode`
- `sortKey`
- `sortDirection`

验收标准：

- deep link 刷新后能直接进入对应页面和模式。
- dashboard dock tab identity 不再受 `mode/runId/history/designTab` 漂移影响。
- 所有导航使用 `Link`、`useNavigate` 或本地 route adapter，不再使用 `next/link` 和 `next/navigation`。
- route preload 用于 dashboard、workbench、run history、documents 等重页面。

## TanStack Query 提速方案

Query 迁移目标不是只替换 fetch，而是重建请求生命周期。

### Query Key 规范

推荐 key：

```text
['auth', 'profile']
['configs', { page, pageSize, keyword, mode, sortKey, sortDirection }]
['config', filename]
['workflow', 'status', configFile, runId, 'compact']
['workflow', 'events', configFile, runId, { afterSeq, limit }]
['workflow', 'stateHistory', configFile, runId, { cursor, limit }]
['workflow', 'stepLogs', configFile, runId, { cursor, limit }]
['runs', 'history', { page, pageSize, keyword, status }]
['runs', runId, 'documents', { cursor, limit, includeChildren }]
['schedules']
['agents']
['models']
['engines']
['skills']
['marketplace']
```

### 提速规则

- 分页列表使用 `placeholderData` 或 keep previous data，翻页时不清空页面。
- `staleTime` 按数据类型设置：
  - configs/run history：10-30 秒。
  - workflow compact status：运行中 0-1 秒，停止后 30 秒。
  - documents metadata：30-60 秒。
  - models/engines/skills：60 秒以上。
- 运行页不再每个区域各自 fetch，同一 query key 只请求一次。
- SSE 不直接推完整 snapshot，改为触发 `invalidateQueries` 或追加 event。
- 后台刷新只刷新轻量 compact status，不刷新重详情。
- 页面切换时预取下一步常用数据：
  - 打开 config 前预取 config detail。
  - 进入 workbench 前预取 compact status。
  - 点击 documents tab 前预取第一页 metadata。
- 对失败请求统一 retry 策略：
  - 401/403 不重试。
  - 404 不重试。
  - 429/5xx 指数退避重试 2-3 次。
  - engine transient failure 不在 Query 层盲重试，由 workflow recovery 策略控制。

### API 拆分

运行页从一个大 status 拆成多个 query：

- `getWorkflowStatusCompact()`：当前状态、当前步骤、active steps、计数、最近 seq。
- `getWorkflowEventsPage()`：按 seq 增量读取事件。
- `getStateHistoryPage()`：分页读取状态历史。
- `getStepLogsPage()`：分页读取步骤日志。
- `getDocumentsPage()`：分页读取文档 metadata。
- `getDocumentContent()`：打开具体文档时再读取内容。

验收标准：

- 状态流转不再导致整页完整 snapshot 重渲染。
- workbench 运行页首屏只请求首屏需要的数据。
- 打开历史详情、文档、日志时才请求重数据。
- 大 run 页面 query 数量可解释、可缓存、可失效。

## 按钮状态全量替换

所有会等待网络或引擎响应的按钮必须接入 mutation 状态，不允许“点了没反馈”。

### 必须替换的操作

- 工作流：
  - 启动
  - 停止
  - 恢复
  - 强制跳转
  - 强制完成
  - 召回反馈
  - 迭代
  - 预检
- 配置：
  - 新建
  - 保存
  - 删除
  - 复制
  - 导入
  - 校验
  - 推荐生成
- 调度：
  - 创建 schedule
  - 启用/禁用
  - 手动触发
  - 删除
- 文档：
  - 打开
  - 下载
  - 刷新
  - 展开 child runs
- AI/Agent：
  - 发送消息
  - 停止 streaming
  - 重试 tool-call
  - 生成 avatar
  - 保存 agent
- 系统设置：
  - 保存模型
  - 保存引擎
  - 测试连接
  - 安装/启用 skill
  - marketplace 安装/刷新

### UI 规则

- mutation 开始后同一帧内显示 pending：
  - 主按钮显示 spinner 或进度图标。
  - 危险操作按钮 pending 时禁用。
  - 可取消操作显示 cancel/stop。
- mutation 失败必须显示错误：
  - toast 显示短错误。
  - 详情区域保留可展开错误。
  - 表单字段错误落到对应字段。
- mutation 成功后精确失效：
  - `startWorkflow` invalidates compact status、run history。
  - `saveConfig` invalidates config detail 和 configs list。
  - `triggerSchedule` invalidates schedules、run history。
  - `deleteDocument` invalidates documents page。
- 禁止用全页 `window.location.reload()` 作为成功刷新策略。
- mutation button 组件应抽成统一模式，例如 `AsyncButton` 或 `MutationButton`，避免每个页面手写一套 pending/error。

### 验收标准

- 用户点击任何慢按钮后 100ms 内有视觉反馈。
- pending 状态下不会重复提交同一操作。
- 失败后可重试，且错误不丢失。
- Playwright 覆盖核心按钮的 pending/disabled/error/success 状态。

## TanStack Virtual 性能治理

必须虚拟化或懒渲染：

- 状态机 `stateHistory`。
- workflow event log。
- step logs。
- live stream chunks。
- supervisorFlow / agentFlow。
- documents list。
- workflow configs list。
- run history。
- marketplace/skills 长列表。

规则：

- DOM 节点数量随可视区域增长，不随总数据量增长。
- 大 Markdown/tool result 默认折叠，展开后再渲染。
- streaming chunk 写入时做解析，render 阶段只渲染已解析 item。
- 虚拟列表要支持保底高度、滚动恢复、定位到当前步骤/最新事件。
- 切 tab 时不销毁关键滚动位置。

验收标准：

- 1 万条 event/state/log 数据下页面可滚动、可操作。
- React commit 时间有明确上限，不因日志总量线性增长。
- 大 run 页面首屏 DOM 节点数量低于设定阈值。

## TanStack DB 本地数据层

DB 用于前端本地响应式集合和派生视图，不替换后端持久化。

优先 collections：

- `workflowConfigs`
- `runHistory`
- `documentsMetadata`
- `workflowEvents`
- `stateHistory`
- `stepLogsMetadata`
- `agentMessages`
- `toolCalls`

使用模式：

- Query 负责远端读取和缓存。
- DB 负责本地查询、筛选、排序、派生视图、乐观更新。
- Query 成功后同步到 DB collection。
- mutation 乐观更新先写 DB，失败后 rollback。
- DB collection 不保存后端权威 runtime state，只保存 UI 可恢复视图。

验收标准：

- 配置列表本地筛选排序不重新解析全部 YAML。
- run history 和 documents metadata 切 tab 不重复全量请求。
- event/state history 与 Virtual 结合后只渲染可见数据。
- 乐观更新失败可回滚并显示错误。

## TanStack AI 交互层

AI 迁移目标是统一 streaming、tool-call 和 agent 消息 UI 状态，不替换底层 engine。

迁移范围：

- chat / Agora / agent 消息流。
- workflow step 输出的 streaming item。
- tool-call pending/success/error/collapsed 状态。
- provider/session/tool-call 诊断信息。
- AI 消息与 workflow event log 的映射关系。

边界：

- ACP、Claude、OpenCode、Codex 仍由现有 engine 层执行。
- context recovery、session rebuild、engine health check 仍在 server/workflow 层。
- AI UI 层不得吞掉 engine 异常；必须把错误映射成可诊断状态。

验收标准：

- streaming 输出不再在 render 阶段重复 parse 大 chunk。
- tool-call 展示一致，错误可见，可重试。
- agent 消息能定位到 runId、stepKey、eventSeq。
- 引擎异常显示 provider、session、tool-call 或 context 信息。

## 服务端与启动迁移

TanStack Start 是替换 Next 的主框架，不是候选项。

必须完成：

- `package.json` scripts 从 `next build` / `server.js start` 切到 Start/Vite 构建和启动。
- `ace start` 启动 Start production server。
- scheduler restore 在 server ready 后显式执行。
- memory watchdog 从 Next instrumentation 迁到 Start/Node bootstrap。
- notebook WebSocket upgrade 从 Next custom server 迁到 Start/Node bootstrap。
- 保留 `BASEURL` / `BASE_URL` / 静态资源前缀 / API 前缀 / WebSocket 路径兼容。
- npm package 不再发布 `.next/**`。

全局 npm 安装验收：

- `npm install -g` 后 `ace start` 可启动。
- 启动后 scheduler 自动恢复，不依赖访问 schedules 页面。
- WebSocket、SSE、API、deep link 都在 base path 下可用。
- 不再出现 `Failed to load external module node-cron-xxx`。

## 配置分页与文档加载

配置列表必须从“返回分页”改成“读取分页”：

- 无 keyword/mode 过滤且按 createdAt 排序时，先按轻量 metadata/stat 排序分页，再只解析当前页 YAML。
- 有 keyword/mode/name sort 时，如果仍需全量解析，必须进入索引慢路径并记录耗时。
- 中期建立 `workflow-config-index.json` 或 SQLite 索引。
- owner 信息批量读取，不在循环中逐个查用户。

文档 tab：

- 默认只加载 root run 第一页 documents metadata。
- child run 文档展开时懒加载。
- 文件内容打开时再读。
- metadata 用 Query + DB 缓存，列表用 Virtual 渲染。

## 状态流转与步骤交接优化

要解决的不只是固定 30 秒 delay，还包括状态流转链路过重。

优化项：

- 非 Claude 固定 segment delay 默认关闭，改成可配置 adaptive backoff。
- Supervisor state review 默认异步，不阻塞自动流转。
- checkpoint advice 只在人审状态需要时执行。
- `persistState()` 拆成轻量 runtime state 和重详情异步写。
- spec revision vote 不抢占主执行 engine lock。
- 自动上下文压缩只在阈值或错误信号触发。
- 状态流转链路记录耗时分解：
  - segment delay
  - supervisor review
  - checkpoint advice
  - persistState
  - spec vote
  - engine init
  - context compact
  - frontend render

## 测试矩阵

### 单元测试

- route search params schema。
- query key builder。
- mutation state reducer。
- API client error classification。
- DB collection sync/rollback。
- AI streaming parser/tool-call state。
- Virtual list item measurement。

### 组件测试

- 所有核心按钮 pending/disabled/error/success。
- configs list 分页和 loading。
- run history keep previous data。
- documents lazy load。
- state history virtual scroll。
- live stream virtual scroll。
- tool-call 展开/折叠/错误。

### Contract 测试

- API URL 和 JSON shape 与迁移前一致。
- workflow start/stop/resume/force-transition/status/events。
- configs list/detail/save/delete/validate。
- schedules create/toggle/trigger/delete。
- documents list/content。
- auth profile/login/register/setup。

### E2E 测试

- `/dashboard?route=/workbench/<config>?mode=history` 刷新直达。
- 启动工作流后按钮立即 pending。
- 强制跳转 pending -> status 更新 -> 解锁。
- 大 run 页面打开、滚动、切 tab 不明显卡顿。
- documents tab 首次只加载 metadata，展开 child 才请求 child。
- configs 翻页不全量解析。
- AI streaming tool-call 状态可见。
- 登录、注册、setup、权限访问保持兼容。

### 性能测试

- Vite/Start dev cold start。
- HMR 修改组件耗时。
- production build 耗时。
- workbench 大 run 首屏耗时。
- status/event/log 每次更新 React commit 耗时。
- 1 万条 event/log 虚拟列表滚动帧率。
- configs 1k/5k/10k 文件分页读取耗时。
- documents 1k/10k metadata 加载耗时。

### 全局安装 Smoke

- `npm pack`。
- 新目录 `npm install -g <tgz>`。
- `ace start`。
- 访问 dashboard deep link。
- 创建并触发 schedule。
- 验证 scheduler restore。
- 验证 WebSocket。
- 验证 SSE。
- 验证 base path。

## 执行阶段

1. 回退 Nitro 半成品代码，保留 TanStack 计划和依赖。
2. 引入 TanStack Start/Vite 基础配置和 production bootstrap。
3. 建立 TanStack Router route tree 和 search params schema。
4. 建立 QueryClient、API client、query key、mutation 规范。
5. 建立 MutationButton/AsyncButton 并替换核心慢按钮。
6. 建立 Virtual list 基础组件，迁移状态历史、实时日志、文档和配置列表。
7. 拆分 workflow compact status、events、state history、step logs、documents API。
8. 引入 TanStack DB collections，同步 Query 数据和乐观更新。
9. 引入 TanStack AI streaming/tool-call/agent message 层。
10. 迁移 pages 和 API routes 到 TanStack Start。
11. 替换 `ace start`、scheduler restore、WebSocket、memory watchdog。
12. 删除 Next 依赖、`.next` 发布产物和 Next custom server。
13. 跑完整测试矩阵和全局安装 smoke。
14. 发布 beta 包验证。

## 回滚策略

- 合并前保留当前 Next 主线可发布。
- TanStack Start 分支独立发布 beta 包。
- 如果 Start server、登录、全局 npm、scheduler、WebSocket、base path 任一阻断失败，停止合并并回退到 Next 主线。
- Query/DB/AI/Virtual 改动保持 API shape 不变，便于局部回滚。

## 完成定义

迁移完成必须同时满足：

- 生产不再依赖 Next runtime。
- npm 包不再发布 `.next/**`。
- `ace start` 启动 TanStack Start server。
- 当前主要页面 deep link 可刷新直达。
- 核心 API contract 保持兼容。
- 所有慢按钮有 loading/error/success 状态。
- 状态机运行页、documents、configs、run history 使用分页/虚拟化/缓存。
- TanStack DB 和 TanStack AI 已进入实际代码路径。
- 全局 npm 安装 smoke 通过。
