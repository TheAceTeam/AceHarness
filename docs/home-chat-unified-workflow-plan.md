# 首页对话统一工作流与多 Agent 群聊十阶段计划

## 总目标

把首页的「普通对话 / 议场 / 工作流」统一为一个对话入口：普通对话可以拉 Agent 进来变成群聊，也可以通过 `/workflow` 在当前对话内创建、确认并直接执行轻量工作流。工作流运行后，当前对话升级为绑定运行的多 Agent 群聊，实时输出和监控面板通过右侧插件边栏展示。

本计划只改首页对话体验。工作流内部已有的议场先不动。

## 阶段 1：统一产品模型

目标：把首页对话定义为唯一协作容器，明确所有后续改造的状态模型。

会话状态收敛为：

- `plain`：普通一对一 AI 对话。
- `agent-chat`：已拉入一个或多个 Agent 的群聊。
- `workflow-drafting`：正在当前对话内创建轻量工作流。
- `workflow-running`：已绑定 workflow run，进入工作流多 Agent 群聊。
- `workflow-completed`：运行结束，可继续讨论、复盘、再次发起新工作流。

关键要求：

- 用户不再需要选择「议场」或「工作流」入口。
- `workflow run / event store / spec store` 继续作为事实来源。
- 聊天 transcript 只作为用户可读投影，不作为运行恢复的唯一依据。

验收点：

- 文档、类型和 UI 文案都以「对话」作为首页主入口。
- 旧「议场」「工作流」概念只作为对话能力和徽标存在。

## 阶段 2：首页导航与目录收敛

目标：删除首页层面的「议场」「工作流」两个 tab，把所有会话放进单一对话列表。

改造范围：

- `DashboardPageShell`：删除首页对话目录切换逻辑。
- `ChatSidebar`：从 `conversation/agora/workflow` 三分目录收敛为单一列表。
- 旧议场会话：作为带 `collaborationRoom` 的对话显示。
- 旧工作流会话：作为带 `workflowBinding` 或 `creationSession` 的对话显示。

列表展示：

- 普通对话：默认样式。
- 群聊对话：显示「群聊」徽标。
- 工作流创建中：显示「创建中」徽标。
- 工作流运行中：显示「运行中」徽标。
- 工作流已完成：显示「已完成」徽标。

保留高级入口：

- `/workflows`：工作流配置管理和高级运行入口。
- `/run-history`：历史运行审计。
- `/workbench/[config]`：深度调试和执行详情。

验收点：

- 首页不再出现「议场」「工作流」两个对话目录 tab。
- 旧议场和旧工作流会话仍可从普通对话列表打开。
- 搜索、重命名、批量管理仍可用。

## 阶段 3：删除保护与后端一致性

目标：运行中的 workflow-bound 对话不能被删除，前后端必须一致。

删除规则：

- `plain` 和普通 `agent-chat` 可以删除。
- `workflow-drafting` 可以删除，但需要提示会丢弃创建草案。
- `workflow-running` 不允许删除。
- `workflow-completed` 可以删除，但需要二次确认，并说明不会删除 run history 和配置。

后端要求：

- `/api/chat/sessions/[id]` 的 DELETE 必须拒绝删除运行中 workflow-bound 会话。
- `/api/chat/sessions/batch-delete` 必须执行同样校验。
- 不能只在前端禁用按钮。

运行中判定：

- 优先看 live run status。
- live 状态不可用时读取持久化 run state。
- `preparing / pending / starting / running / waiting / waiting-human / waiting-approval` 视为不可删除。

验收点：

- 前端运行中会话删除按钮禁用或提示不可删。
- 批量删除会跳过或拒绝运行中会话。
- 直接调用后端删除接口也不能删除运行中会话。

## 阶段 4：右侧插件边栏框架

目标：实时输出、群聊监控和工作流监控都通过右侧插件边栏实现，不在聊天页硬编码。

布局：

- 左侧：会话列表。
- 中间：聊天主流，只展示用户需要读的内容。
- 右侧：插件边栏，承载实时输出、监控、事件和控制。

插件协议示意：

```ts
interface ConversationRightRailPlugin {
  id: string;
  title: string;
  icon?: string;
  priority: number;
  modes: HomeConversationMode[];
  shouldActivate(context: ConversationRightRailContext): boolean;
  subscribe?: (context: ConversationRightRailContext) => ConversationRightRailDataSource[];
  render: (props: ConversationRightRailPluginProps) => ReactNode;
}
```

内置插件：

- `assistant-live-output`：普通对话实时输出、工具调用、上下文摘要。
- `agent-room-monitor`：群聊成员、响应模式、发言队列、Agent 实时输出。
- `workflow-monitor`：运行中工作流监控面板。
- `changes-monitor`：文件变更、git diff、workbench 跳转。

边栏原则：

- 插件声明适用 mode、优先级、标题、图标、数据订阅和操作权限。
- 同一会话可有多个右侧插件。
- 默认展示最高优先级插件，用户可切换。
- 边栏可折叠、可固定，移动端以 drawer 展示。
- 边栏状态按 session 持久化，不能污染其他对话。

验收点：

- `ConversationRightRail` 只做容器和插件调度。
- 聊天页不硬编码 workflow 监控、群聊监控或变更面板。
- 普通对话、群聊、工作流运行都能自动激活合适插件。
- 轻量工作流未启动前不显示右侧边栏；补充问答、草案生成、执行目录确认都在聊天主流中完成。

## 阶段 5：普通对话升级为多 Agent 群聊

目标：普通对话支持拉 Agent 入群，完整迁移议场的群聊基础能力。

用户能力：

- 点击「拉 Agent」添加一个或多个 Agent。
- 输入 `@agent` 自动弹出候选并点名。
- 输入 `@全员` 触发群内所有可响应 Agent。
- 对某条消息点「请他接话」「引用并 @」触发上下文接续。
- Agent 入群后自动打招呼。

数据要求：

- 第一次拉 Agent 入群时，对话从 `plain` 升级为 `agent-chat`。
- 初始化或复用 `sessionWorkbenchState.collaborationRoom.chatroom`。
- participant roster、agent session、temporary guest 都挂在当前 chat session 下。

迁移能力：

- participant roster。
- 临时嘉宾 / Agent 嘉宾。
- Agent 入群打招呼。
- Agent session 复用。
- Agent 执行引擎和模型 override。
- 群聊消息中的 cards / structured result 渲染。

验收点：

- 任意普通对话都能拉 Agent 入群。
- `@agent`、`@全员`、引用点名都能在主输入框工作。
- 群聊 transcript 仍在当前对话里，不跳到独立议场页面。

## 阶段 6：群聊三种响应模式

目标：完整保留并迁移点名、广播、主持人三种群聊响应模式。

### 点名模式

默认模式，适合普通轻量对话：

- 只有被 `@agent`、`@全员` 或引用点名的 Agent 响应。
- 未点名时只由默认助手响应，避免多 Agent 抢话。
- 工作流运行中的用户反馈默认进入协调型嘉宾。

### 广播模式

适合评审、头脑风暴、方案比较：

- 用户消息广播给当前群内所有可响应 Agent。
- 可设置每轮最大响应人数、每个 Agent 最大回复次数和轮次上限。
- 支持「全员一轮」「按角色分批」「只广播给选中的标签/团队」三种范围。
- 系统显示当前广播轮次。
- 广播结果进入同一个 transcript，用户可继续点名追问。

### 主持人模式

适合复杂讨论和工作流运行：

- 指定主持人 Agent，默认可以是 `default-supervisor` 或 workflow supervisor。
- 用户消息先进入主持人，由主持人决定邀请哪些 Agent、发言顺序和是否总结。
- 主持人可发起讨论、收束结论、要求复核、向用户提出确认问题。
- 用户仍可直接 `@agent` 绕过主持人点名。

工作流运行绑定后，默认建议使用主持人模式。用户可切回点名或广播。

验收点：

- 群聊可在三种模式之间切换。
- 广播模式触发多 Agent 同轮响应。
- 主持人模式能组织发言顺序和总结。
- 当前模式在聊天页和右侧 `agent-room-monitor` 插件中可见。

## 阶段 7：`/workflow` 轻量创建入口

目标：在当前对话中启动轻量工作流创建流程，默认非 spec 模式。

入口：

- 明确命令：`/workflow ...`
- 输入框旁的「工作流」按钮。
- AI 建议卡：普通对话中识别出任务适合流程化执行时给出建议。

流程：

1. 当前对话进入 `workflow-drafting`。
2. 插入「轻量工作流创建卡片」到当前聊天主流。
3. 卡片内嵌结构化表单，支持单选、多选、单行输入、多行输入和确认动作。
4. 不跳转 `NewConfigModal`。
5. 不打开右侧边栏；右侧边栏只在 workflow run 开始后作为运行状态监控出现。

非 spec 模式原则：

- 默认不生成完整 requirements/design/tasks 制品确认流程。
- 但必须保留补充问答和草案确认。
- 体验接近 Claude plan mode：轻量、可确认、可直接执行。

验收点：

- 输入 `/workflow 需求...` 后仍停留在当前对话页。
- 当前对话出现 workflow 创建卡片。
- 输入 `/workflow` 后按 Enter 能选中命令、关闭 slash 菜单，并进入聊天内轻量创建流程。
- 创建状态可刷新恢复。

## 阶段 8：非 spec 补充问答与草案确认

目标：修复现有非 spec / 快速编排会跳过补充问答的问题。

补充问答：

- 使用 `workflow_clarification_summary`、`workflow_clarification_facts`、`workflow_clarification_gaps`、`workflow_clarification_question`。
- 默认生成 3 到 5 个问题。
- 只问会影响流程、Agent 分工、工作目录、验收方式和风险边界的问题。
- 每题支持推荐选项、备选选项、自由补充和跳过默认值。
- 聊天卡片必须能渲染并提交结构化输入控件：单选、多选、单行输入、多行输入。
- 单选用于执行范围、Agent 分工、是否立即启动；多选用于验收方式、风险边界、需要执行的检查；输入框用于执行目录、配置名称、目标产出和补充说明。
- 用户可在卡片中回答，也可直接聊天回答。
- 回答持久化到 `creationSession.uiState` 或新的轻量 draft state。

草案确认：

- 工作流名称与目标。
- 工作目录与执行模式。
- 参与 Agent 与 supervisor / coordinator。
- 状态或阶段列表。
- 每个状态的关键步骤。
- 验收方式。
- 风险和默认假设。

用户操作：

- 直接确认。
- 修改某个阶段或 Agent 分工。
- 要求 AI 重新生成。
- 切换为完整 spec 模式。

验收点：

- 非 spec 模式一定出现补充问答，除非用户显式选择跳过并使用默认假设。
- 草案确认前不写入正式 workflow config。
- 问答和草案都在当前对话中内嵌显示。
- 工作流真正开始执行前，右侧边栏保持隐藏。

## 阶段 9：生成配置、自动启动与工作流群聊绑定

目标：草案确认后自动生成 workflow config，立即启动运行，并把当前对话升级为 workflow 多 Agent 群聊。

流程：

1. 调用配置生成逻辑写入 workflow config。
2. 在聊天主流询问执行目录、运行方式，以及是否立即在当前目录运行。
3. 用户确认后调用 `/api/workflow/start`。
4. 传入当前 `frontendSessionId`。
5. 启动成功后更新当前 chat session 的 `workflowBinding` 或 `embeddedWorkflow`。
6. 当前对话进入 `workflow-running`。
7. 此时才展开右侧 `workflow-monitor`，展示状态图、事件、待回答问题和控制按钮。

运行后自动拉入：

- 创建嘉宾：解释创建阶段上下文和草案取舍。
- 协调型嘉宾：原 supervisor agent，以自然群聊成员身份同步路由和风险。
- 步骤 Agent：workflow states/phases 中实际执行步骤的 Agent。

事件投影：

- 阶段开始：对应 Agent 简短说明接下来做什么。
- 步骤完成：执行 Agent 汇报结果。
- 等待人工：协调型嘉宾向用户提问，并显示问答卡。
- 失败：相关 Agent 说明失败点和下一步选择。
- 完成：协调型嘉宾总结结果并给出复盘入口。

验收点：

- 确认草案后无需跳转即可生成配置并启动。
- 当前对话自动绑定 runId。
- 当前对话自动进入多 Agent 工作流群聊。
- preflight 阻塞时在当前对话内显示确认卡。

## 阶段 10：监控、兼容收尾与资源清理

目标：完成工作流右侧监控、旧入口兼容、测试更新和无用静态资源清理。

`workflow-monitor` 插件至少包含：

- `Status`：运行状态、当前状态/阶段、步骤进度、耗时。
- `Live Output`：当前执行 Agent 的实时输出流和最近错误。
- `Questions`：待回答的人类问题和历史回答。
- `Events`：结构化 workflow events 时间线。
- `Changes`：文件变更摘要、git diff 入口、workbench 入口。
- `Controls`：停止、继续、重试、跳转状态、审批等操作。

实时数据源：

- chat stream。
- agent stream。
- workflow live status。
- workflow event log。
- human questions。
- git diff / workspace changes。

兼容迁移：

- 旧议场会话保留 transcript 和 roster，显示为群聊对话。
- 旧工作流会话保留 binding，打开后显示右侧 `workflow-monitor`。
- `homeSidebar.tab = workflow | commander | agent` 迁移期只读兼容，新写入走 conversation state 和 right rail plugin state。

静态资源清理：

- 清点旧 tab 图标。
- 清点旧首页议场 / 工作流入口素材。
- 清点已废弃插件资源。
- 删除前必须用引用扫描确认未被工作流内部议场、狼人杀扩展、文档或 README 使用。

验收点：

- 工作流运行时右侧插件可看到实时输出、当前步骤、事件、人类问题、控制按钮和文件变更入口。
- 普通 Agent 群聊时右侧插件可看到成员、响应模式、发言队列和 Agent 实时输出。
- 旧会话能打开且不丢上下文。
- 相关测试更新完成。
- 无用静态资源已删除，且构建通过。

## 总体验收标准

- 首页只有「对话」主入口。
- 普通对话可以拉 Agent 入群并完整支持 `@agent`、`@全员`、点名接话、入群打招呼。
- 群聊支持点名、广播、主持人三种模式。
- `/workflow` 可以在当前对话内完成补充问答、草案确认、配置生成和自动启动。
- 非 spec 模式不会再跳过补充问答。
- 工作流运行后当前对话升级为多 Agent 工作流群聊。
- 右侧边栏由插件注册表驱动，不硬编码工作流或群聊面板。
- 运行中的 workflow-bound 对话前后端都不可删除。
- 工作流内部已有议场不受影响。
- 用不到的静态资源在最后阶段清理。

## 关键风险

- 不能把自然语言 transcript 当作唯一事实来源。
- `/workflow` 需要避免误触发。
- 自动启动遇到 preflight 阻塞时必须留在对话内处理。
- Agent 入群开场和 workflow 事件投影要限流。
- 删除 tab 后，旧测试中按目录分类的断言需要系统性更新。
- 静态资源清理必须在引用扫描和页面验证之后执行。
