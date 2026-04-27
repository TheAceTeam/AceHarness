# Tasks

## 0. 2026-04-26 刷新结论
- 已完成主链：
  - OpenSpec 前移到创建态，旧 runtime plan 模式已移除。
  - run 启动后会派生独立 OpenSpec snapshot，运行态与创建态职责已分离。
  - Agent 角色大厅、deterministic 头像、统一通讯录、workflow-chat / standalone-chat 边界已基本收口。
  - creator 机制已内建，旧 `aceharness-agent-creator` / `aceharness-workflow-creator` skill 已从仓库删除。
  - preflight、经验沉淀、记忆分层、演练模式都已有基础闭环。
- 当前仍需继续完成的重点：
  - 创建态已经补上制品级编辑 / diff，但更强的阶段承接与历史回看仍未完成。
  - 首页右侧侧栏虽然已有统一状态源，但 orchestrator 仍未彻底抽象完成。
  - 经验库、关系库、编排推荐目前仍以“推荐展示”为主，还没有充分自动反馈到 OpenSpec / YAML 编排决策。

## 1. OpenSpec 基础落位
- [x] 1.1 创建 `openspec` skill，明确官方 OpenSpec 与内部 OpenSpecDocument 的边界
- [x] 1.2 将 workflow creator skill 接入 openspec skill 的触发约束
- [x] 1.3 在 `docs/spec/openspec/` 下创建本次变更的官方 OpenSpec change 制品

## 2. 当前实现状态映射
- [x] 2.1 从总设计文档提炼当前稳定行为规范到 `specs/supersupervisor/spec.md`
- [x] 2.2 将当前代码已完成能力映射到增量规范
- [x] 2.3 将未完成项映射到 tasks 并保持持续更新

## 3. 创建态主链收口
- [ ] 3.1 将创建流程显式改造成“需求澄清 -> OpenSpec 确认/修订 -> workflow 草案”
  当前状态：部分完成。
  源码现状：
  - `NewConfigModal` 已有三段式 stepper，创建态不会直接跳过到 workflow YAML。
  - 创建态已支持 revision notes 重新生成，并保留 revision 记录。
  - 修订区已增加“修订哪份制品 + 影响哪块 workflow 草案”的显式选择，并把这些上下文写入 revision summary。
  - 生成创建态预览时已先调用 `/api/openspec/ai-draft`，把 AI 需求澄清结果和 AI 生成的 OpenSpec 制品写入 session，并在第 2 步显式展示“AI 需求澄清”。
  - 第 2 步已支持按制品切换 `proposal/design/tasks/spec`，并提供“原文 / 编辑 / 差异”三视图；直接保存会回写创建态 session 并追加 revision。
  - 第 2 步已新增“创建态历史承接”时间线，并会把最近一次 revision 对 workflow 草案的影响高亮到阶段节点、Agent 分工或检查点/状态流转提示上。
  - 创建态 session 已开始沉淀 `artifactSnapshots`；第 2 步可选择历史版本快照，对比当前制品或未保存修改，支持跨 revision 的版本回看。
  - 参考实现：`src/components/NewConfigModal.tsx`
  仍缺：
  - 需求澄清、正式 OpenSpec 制品、workflow 草案三段虽然已有 stepper，但更完整的历史版本回看和跨 revision 对比仍可继续强化。
  直接下一步：
  - 继续补更细的 revision 对 revision 对比，以及制品级 diff 与 workflow 草案映射的更强联动。
- [x] 3.2 将当前创建态“假 OpenSpec 预览”替换为正式 OpenSpec 制品视图
  当前状态：已完成基础版本。
  源码现状：
  - 创建态会话已在 `openSpec.artifacts` 中保存 `proposal/design/tasks/deltaSpec` 文本。
  - `NewConfigModal` 第 2 步已按制品维度展示 `proposal.md`、`design.md`、`tasks.md`、`specs/.../spec.md`。
  - `/api/openspec/ai-draft` 已改为优先由 AI 生成这些制品，再回填到创建态 session；本地派生只保留为兜底。
  - 第 2 步已支持制品级直接编辑、差异预览与保存回 session，不再只是只读预览。
  - 参考实现：`src/components/NewConfigModal.tsx`、`src/lib/openspec-store.ts`
  仍缺：
  - 当前正式制品内容仍由系统内建模板/派生逻辑生成，还没有真正让创建态 AI 严格执行 `skills/openspec` 的完整生成闭环。
  - 制品级 diff 仍是轻量文本对比，还没有更细的结构化差异与 workflow 映射联动。
  直接下一步：
  - 将创建态的 AI 生成链路改成真正以 `skills/openspec` 为先，而不是主要依赖内部派生。
- [x] 3.3 基于已确认 spec 产出 workflow 草案
  当前状态：已完成基础闭环。
  源码现状：
  - 创建态 session 已新增 `workflowDraftSummary`，会展示节点摘要、Agent 分工和来源说明。
  - 页面已显式展示“依据这份 spec 的节点与分工派生 workflow 步骤和 Agent 分配”。
  - 正式 `tasks.md` 条目已解析为运行态 `OpenSpecDocument.tasks` 投影，并通过 phaseId 与 workflow phase/state 状态建立稳定映射。
  - 运行态 phase/state 状态变化会同步回正式 `artifacts.tasks` checkbox 与 hidden metadata。
  - 参考实现：`src/components/NewConfigModal.tsx`、`src/lib/openspec-store.ts`、`src/lib/state-machine-workflow-manager.ts`、`src/app/api/workflow/status/route.ts`
  改进项：
  - 创建态 AI 生成链路还可以继续强化为“先由 `skills/openspec` 生成制品，再由制品驱动 YAML”的严格自动化闭环。
- [x] 3.4 删除旧 runtime plan 模式与相关输入 UI
  当前状态：已完成。
  源码现状：
  - `workbench/[config]/page.tsx` 已移除旧问答与审批弹窗、状态恢复、事件处理和启动重置残留引用。
  - `/api/workflow/plan-answer` 已删除，API 文档、SSE registry、run persistence、schema 中的旧入口也已清理。
  - `WorkflowManager` / `StateMachineWorkflowManager` 不再执行旧循环或 SDK plan 分支。
  - `ClaudeCodeEngineWrapper` 已删除 SDK plan mode、AskUserQuestion 桥、`.claude/plans` 捕获与相关事件。
  - workflow 创建、AI 生成、validator、示例配置和配置 README 已移除旧 plan 字段。
  - 旧 Supervisor plan 设计文档已删除，总设计文档已改为创建态 OpenSpec 承载规划。
  - 参考实现：`src/app/workbench/[config]/page.tsx`、`src/lib/engines/claude-code-wrapper.ts`、`src/lib/engine-interface.ts`、`src/lib/state-machine-workflow-manager.ts`、`src/lib/workflow-manager.ts`、`src/app/api/workflow/events/route.ts`、`src/lib/workflow-registry.ts`
- [x] 3.5 将 plan 职责前移到创建态并以 OpenSpec 承载
  当前状态：已完成基础闭环。
  源码现状：
  - 创建态已有“需求澄清 -> OpenSpec 确认/修订 -> workflow 草案”主链。
  - `NewConfigModal` 的 AI 引导提示已明确要求先显式使用 `skills/openspec` 产出 `proposal.md`、`design.md`、`tasks.md`、`specs/.../spec.md`。
  - 创建态 session 保存正式 OpenSpec artifacts，确认后再生成 workflow，并在 run 启动时复制为独立 spec snapshot。
  - 运行态只消费确认后的 spec snapshot，不再承担需求收集或规划问答职责。
  - 参考实现：`src/components/NewConfigModal.tsx`、`src/lib/openspec-store.ts`、`src/app/api/openspec/sessions/route.ts`、`src/app/api/configs/create/route.ts`
  改进项：
  - 创建态内部派生制品仍可继续升级为更强的 AI 驱动制品生成与差异编辑 UI；该项归入 3.1 / 3.2 的后续强化。

## 4. 首页与运行态收口
- [x] 4.1 继续收口首页动态侧栏的信息分层
- [x] 4.2 强化 workflow 页设计输入与执行进展的映射
- [x] 4.3 补 checkpoint 中查看当前 OpenSpec 与偏差说明
- [x] 4.4 落实运行态 spec 权限分层：每一步仅可更新状态，非状态修订由 Supervisor 负责
- [x] 4.5 run 启动时派生独立 spec snapshot，不再让多个 run 共用同一份运行态 spec
- [x] 4.6 为 Supervisor 和普通运行 Agent 注入统一的 spec prompt 契约
- [x] 4.7 明确 workflow YAML 到内部 spec 的字段映射和 source of truth
- [x] 4.8 将状态回写与 revision 更新拆成两条独立链路
- [x] 4.9 收口为“一套 OpenSpec、两种载体”
  当前状态：已完成基础闭环。
  源码现状：
  - 正式 OpenSpec 制品已存入 `openSpec.artifacts`，运行时仍使用 `OpenSpecDocument` 承载 `phases/progress/revisions`。
  - run 启动时会从创建态 OpenSpec 派生独立 snapshot。
  - `OpenSpecDocument.tasks` 现在是 `artifacts.tasks` 的结构化投影，状态回写会同步更新正式 `tasks.md` 文本中的 checkbox 和 task metadata。
  - `/api/workflow/status` 会返回 `openSpecSummary.taskCount` 与 `openSpecDetails.tasks`，workflow 页和首页侧栏能看到正式 task 进度。
  - 参考实现：`src/lib/schemas.ts`、`src/lib/openspec-store.ts`、`src/lib/state-machine-workflow-manager.ts`、`src/app/api/workflow/status/route.ts`、`src/app/workbench/[config]/page.tsx`、`src/components/chat/HomeCommandSidebar.tsx`
  已完成：
  - 已经不是两套完全无关的机制；运行态 snapshot 明确从创建态 OpenSpec 派生，并把 `tasks.md` 解析为运行态任务投影。
  - 普通 agent 只能刷新状态，Supervisor 负责非状态修订，这套权限已经落到运行态 prompt 和 revision 逻辑。
  - 正式 task 条目 id 与运行态 phase id 建立了稳定映射；运行态 phase 状态变化会同步到对应 task 状态。
  改进项：
  - 后续 Supervisor 做结构性修订时，还可以进一步补制品级 diff 展示。
- [x] 4.10 workflow 内支持查看运行态 OpenSpec
  当前状态：已完成。
  源码现状：
  - `/api/workflow/status` 已返回 `openSpecSummary/openSpecDetails/sourceOfTruth`。
  - workflow 页与首页侧栏均可查看 run OpenSpec 版本、阶段、分工、检查点、修订记录。
  - 参考实现：`src/app/api/workflow/status/route.ts`、`src/app/workbench/[config]/page.tsx`、`src/components/chat/HomeCommandSidebar.tsx`
- [x] 4.11 Supervisor 可修订，普通 Agent 只能刷新进度
  当前状态：已完成，但当前主要作用于运行态 `OpenSpecDocument`。
  源码现状：
  - 普通步骤 prompt 明确“只能更新状态类变化，非状态修订由 Supervisor 负责”。
  - Supervisor review 会写入 revision；普通步骤完成后会通过 `markOpenSpecStateStatus` 更新 phase/progress。
  - 参考实现：`src/lib/state-machine-workflow-manager.ts`、`src/lib/openspec-store.ts`
  仍缺：
  - 这套机制目前还没有完整映射到正式 `tasks.md` 的条目级回写，只在运行态对象层生效。
- [x] 4.12 正式 `tasks.md` 条目进度与运行态状态双向绑定
  当前状态：已完成基础版本。
  源码现状：
  - `openSpec.artifacts.tasks` 会被解析为 `OpenSpecDocument.tasks`，支持 task id、title、status、phaseId、ownerAgents、updatedAt、updatedBy、validation。
  - 创建态 session 保存和读取时会归一化 task 投影；run 启动时会复制独立 snapshot。
  - `markOpenSpecStateStatus` 会把运行态 phase 状态同步回对应 task，并更新 `artifacts.tasks` checkbox 与 hidden metadata。
  - 普通 Agent prompt 已说明只能推进状态，系统会同步到正式 `tasks.md`；Supervisor prompt 会看到 task 总体进度并负责非状态修订。
  - workflow 页会展示正式 tasks.md 进度列表，首页侧栏会展示 taskCount。
  - 参考实现：`src/lib/schemas.ts`、`src/lib/openspec-store.ts`、`src/lib/state-machine-workflow-manager.ts`、`src/app/api/workflow/status/route.ts`、`src/app/workbench/[config]/page.tsx`
  改进项：
  - Supervisor 结构性修订 task 内容时，还可以继续补更细的制品级 diff UI。
- [x] 4.13 升级 `skills/openspec/templates` 为高保真模板
  当前状态：已完成。
  源码现状：
  - `skills/openspec/templates/` 下的 `spec/proposal/design/tasks/delta-spec` 五个模板已从占位骨架升级为高保真模板。
  - `tasks.md` 模板已包含执行规则、规范确认、设计落地、OpenSpec 同步、验证、收口等阶段。
  - `tasks.md` 模板已明确普通 agent 只能更新进度，Supervisor / owner 可以修订任务内容、范围、分工或验收标准。
  - `SKILL.md` 已补充 OpenSpec 核心原则、`specs/` 与 `changes/` 关系、制品职责、执行循环、更新规则、校验命令，以及“一套 OpenSpec、两种载体”的项目约束。
  - 参考实现：`skills/openspec/SKILL.md`、`skills/openspec/PROMPT.md`、`skills/openspec/templates/`

## 5. Agent 与平台能力
- [ ] 5.1 收口 Agent 创建入口与推荐链路
  当前状态：部分完成。
  源码现状：
  - 首页右侧侧栏已支持基于 `home_sidebar.agentDraft` 自动预填 Agent 草案，并可直接拉起 `AIAgentCreatorModal`。
  - Agent 管理页也已接入同一个 `AIAgentCreatorModal`，具备独立创建入口。
  - 首页快捷操作已经把“创建 Agent”改成示例引导 + 填入输入框，不再直接把按钮文案当需求。
  - Agent AI 草案接口已开始注入相关历史经验与项目级记忆；首页侧栏发起 Agent 草案时也会把识别到的工作目录一并传入。
  - 已新增共享 `src/lib/agent-draft.ts`，统一 Agent draft 的默认值、字段模型、systemPrompt 生成、specialties 解析与预览草案逻辑；首页侧栏和 `AIAgentCreatorModal` 已接入同一套状态形态。
  - 参考实现：`src/components/chat/HomeCommandSidebar.tsx`、`src/components/AIAgentCreatorModal.tsx`、`src/app/agents/page.tsx`、`src/components/chat/QuickActions.tsx`、`src/app/page.tsx`
  仍缺：
  - 首页创建 Agent、Agent 页创建 Agent、运行态通讯录里的“新增角色”还不是同一套完整状态机与推荐来源。
  - Agent 推荐已接上经验库 / 项目记忆，但关系系统、参考 workflow/已有角色编排信息还没有打通。
  - 当前表单更偏“创建一个配置”，还没有完全收口成“先确定角色定位 -> 再确认执行能力”的统一创建主链。
  直接下一步：
  - 先抽一个统一的 `agentDraft/sessionAgentIntent` 状态源，再把首页、Agent 页、运行态创建入口接到同一套 draft / recommend 流程。
  - [x] 5.1.1 首页已支持通过对话结果预填 Agent 创建表单
  - [x] 5.1.2 Agent 管理页已支持 AI 引导创建 Agent
  - [x] 5.1.3 首页快捷入口已改成“示例提示 + 填入输入框”，避免把按钮提示词污染成真实需求
  - [x] 5.1.4 统一首页、Agent 页、运行态创建入口的 Agent draft 状态模型
    当前已完成：首页侧栏、Agent AI 创建弹框、workbench 运行态 `agents` 标签页的“新增角色”入口已共用 `agent-draft` 共享模型与同一套 `AIAgentCreatorModal`。
  - [x] 5.1.5 为 Agent 创建接入经验库 / 关系系统 / 参考 workflow 的推荐链路
    当前已完成：经验库 / 项目记忆 / 参考 workflow / 协作关系提示已统一注入 Agent AI 草案接口；`AIAgentCreatorModal` 第 3 步会显式展示推荐链路来源，首页、Agent 页、运行态入口共用同一套返回结构。
  - [x] 5.1.6 将 Agent 创建流程收口为“角色定位 -> 能力草案 -> 配置确认”的统一主链
    当前已完成：统一创建弹框已改造成三段式主链，首页侧栏、Agent 页、运行态通讯录入口全部共用这套 `AIAgentCreatorModal`。

- [x] 5.2 补 Agent 通讯录与长期会话沉淀
  当前状态：已完成基础闭环。
  源码现状：
  - workflow 页已有工作流通讯录，可和 Agent / Supervisor 发起 `workflow-chat`，并把 workflow 上下文注入接口。
  - 运行态已持久化 `supervisorSessionId` 与 `attachedAgentSessions`，workflow 页与首页侧栏都能读取绑定信息。
  - Agent 聊天接口已区分 `standalone-chat` 与 `workflow-chat` 两种模式。
  - 已新增共享的 `src/lib/agent-conversations.ts`，统一 run 通讯录目录、工作台会话列表、按 Agent 查找历史绑定会话、基础状态文案；首页指挥官侧栏、左侧 ChatSidebar、workflow 页 Agent 标签页、Agent 页“继续最近会话”入口 已接入这一层。
  - 已新增 `resolveAgentConversationSession` / `resolveWorkflowChatSessionId`，把 workflow-chat / standalone-chat 的复用边界抽到共享层。
  - 首页已支持通过 `sessionId` URL 参数直接切到已有 chat session，给跨页面“继续这条会话”提供了统一入口。
  - Agent chat 已开始把单次对话写入 `chat` scope 记忆，并在后续对话中按模式注入：`workflow-chat` 读 run 绑定会话与 workflow / project / role memory，`standalone-chat` 只读角色独立会话与 role memory。
  - 参考实现：`src/lib/agent-conversations.ts`、`src/components/chat/ChatSidebar.tsx`、`src/components/chat/HomeCommandSidebar.tsx`、`src/app/workbench/[config]/page.tsx`、`src/app/agents/page.tsx`、`src/app/page.tsx`、`src/components/AgentPanel.tsx`、`src/app/api/agents/[name]/chat/route.ts`、`src/lib/state-machine-workflow-manager.ts`、`src/contexts/ChatContext.tsx`
  - [x] 5.2.1 workflow 页已支持带上下文的 Agent / Supervisor 对话
  - [x] 5.2.2 运行态已持久化附着到 run 的 Agent 会话 id
  - [x] 5.2.3 Agent chat 接口已区分 `standalone-chat` 与 `workflow-chat`
  - [x] 5.2.4 统一首页、Agent 页、workflow 页的通讯录目录模型
  - [x] 5.2.5 明确 workflow 结束后继续复用相关 Agent 会话的产品入口
  - [x] 5.2.6 收口 `standalone-chat` / `workflow-chat` 的长期会话沉淀与复用边界

- [ ] 5.3 补 lint/compile、经验回流、记忆分层等平台能力
  当前状态：部分完成。
  源码现状：
  - 运行态已有 `qualityChecks` 持久化与展示，可识别 `lint / compile / test / custom`。
  - workflow 结束后已有 final review、scoreCards、experience，并已沉淀到 `experience-library`。
  - 已新增 `src/lib/workflow-memory-store.ts`，将角色长期记忆、项目级记忆、workflow 记忆、chat 会话记忆独立落盘。
  - workflow status 已返回带 `schema / role / project / workflow / chat / recalledExperiences` 的真实 `memoryLayers`，页面可展示多层记忆。
  - 已新增独立的 workflow preflight 后端入口，首页侧栏 / workbench 启动前都会先执行检查；`/api/workflow/start` 也已增加兜底 preflight，避免被其他入口绕过。
  - preflight 结果现在已可传入 workflow start，并写入 manager / run state 的 `qualityChecks`，不再只是启动前临时提示。
  - workflow AI 生成与 Agent AI 草案都已开始召回历史经验；运行态 Supervisor prompt 也已从“仅按 configFile 精确命中”升级为按 workflowName / requirements / projectRoot / agentName 的相关经验召回。
  - 参考实现：`src/lib/state-machine-workflow-manager.ts`、`src/lib/workflow-preflight.ts`、`src/app/api/workflow/preflight/route.ts`、`src/app/api/workflow/start/route.ts`、`src/app/api/workflow/status/route.ts`、`src/lib/workflow-experience-store.ts`、`src/app/workbench/[config]/page.tsx`、`src/components/chat/HomeCommandSidebar.tsx`
  仍缺：
  - 经验库已经回流到创建 workflow / Agent 创建 / 运行态 Supervisor，但还没有完全升级成自动编排决策。
  直接下一步：
  - 继续把经验回流推进到更强的 OpenSpec / YAML 自动编排决策。
  - [x] 5.3.1 运行态已支持质量检查结果采集与展示
  - [x] 5.3.2 工作流结束后已支持结构化经验沉淀
  - [x] 5.3.3 workflow status 已支持基础 memoryLayers 展示
  - [x] 5.3.4 将 lint / compile 升级为 workflow 启动前统一 preflight
    当前已完成：首页 / workbench / start API 已接入统一 preflight，结果会写入 run 级 `qualityChecks`；当 workflow 未显式配置 `preCommands` 时，会自动按项目结构推断 `npm run lint` / `npm run build` / `npm run typecheck` / `npx tsc --noEmit` / `cjpm build` 等默认检查，并在结果中标识为 `inferred`。最近一次 preflight 结果也会沉淀到 chat session 的 `sessionWorkbenchState`，首页侧栏刷新后仍可恢复展示。
  - [x] 5.3.5 将经验库回流到创建 workflow / OpenSpec 修订 / Agent 创建 / 编排推荐
    当前已完成：创建 workflow、OpenSpec 修订、Agent 创建、运行态 Supervisor 已接入；`NewConfigModal` 已新增编排推荐面板，会按当前需求 / 参考 workflow / 工作目录召回历史经验，并展示参考 workflow 的角色骨架、参考指挥官与关系系统协同提示。当前在用户未手动指定参考 workflow 时，系统会按相关历史经验自动采用推荐骨架参与 OpenSpec 预览和 workflow 草案派生；同时推荐接口已进一步产出 `recommendedAgents` / `recommendedSupervisorAgent`，默认预览 skeleton 不再固定写死 `architect/developer/default-supervisor`，而是会真实采用经验库 + 关系系统回流后的自动编排决策。
    后续可选增强：若未来还需要更强的自动编排，可继续把推荐理由映射为更细粒度的 phase/state 级任务模版与节点排序，但当前主链已经闭环。
  - [x] 5.3.6 将 memoryLayers 升级为真正的多层记忆 schema、存储与注入规则

## 6. 总设计文档对齐待办
- [x] 6.1 Agent 管理页角色大厅收口
  当前状态：基础收口完成。
  源码现状：
  - Agent 页已经是“角色大厅”风格，有大卡片、阵营分组、推荐入口链路、Supervisor 独立区块。
  - AgentHeroCard 已升级为更强的角色卡样式，强化头像占比、档案摘要、技能组和卡面装饰，不再是单纯信息卡。
  - Agent 页的阵营区块已改成编队陈列结构，加入编队总览、阵营卡面背景和每张卡下方的操作/最近会话面板。
  - 最新样式已把模型/会话/编辑/删除等管理入口进一步收进卡面底部，卡片尺寸收紧为更接近“角色名册墙”的密度，不再外挂成明显后台操作条。
  - 基础设定与头像编辑区也已调整为更统一的面板式视觉，保持 deterministic 头像管理但降低表单拥挤感。
  - 顶部工具按钮和筛选区域已降噪，批量操作被后置到次级入口，筛选区改成“编队筛选”面板，不再直接呈现为后台工具条。
  - 参考实现：`src/app/agents/page.tsx`、`src/components/agent/AgentHeroCard.tsx`、`src/lib/agent-personas.ts`
  仍缺：
  - 卡片下方的操作/会话信息仍然存在明显工具属性，后续若继续追求沉浸感，可进一步抽成悬浮详情面板或侧边抽屉。
  - 编辑模型依旧保持轻量，不额外引入与运行无关的角色业务字段。
  直接下一步：
  - 继续只从卡面样式、布局、动效、分组和交互反馈上强化“角色大厅”表现，不扩大 Agent 配置面。
  - 若后续继续优化，优先把卡片下方操作区抽成更轻的悬浮层或详情抽屉。
  - [x] 6.1.1 Agent 管理页已具备角色卡/创建入口等基础角色化展示
  - [x] 6.1.2 已具备 Supervisor 黑金卡与基础一等公民视觉层级
  - [x] 6.1.3 继续强化卡面样式、分组陈列和视觉反馈
  - [x] 6.1.4 将 Agent 页进一步收口为“角色大厅/英雄页”而不是偏配置后台

- [x] 6.2 Agent 头像系统收口
  当前状态：完成。
  源码现状：
  - deterministic 头像、黑金 Supervisor 风格、头像解析与渲染已存在。
  - `generate-avatar` API 现在只负责刷新 deterministic 头像 seed，不再生成或落盘任何正式图片资产。
  - `AIAgentCreatorModal` 和 `AgentEditModal` 都已接到这条链路，刷新头像时统一回到 deterministic 方案。
  - 参考实现：`src/lib/agent-personas.ts`、`src/app/api/agents/generate-avatar/route.ts`、`src/components/AIAgentCreatorModal.tsx`
  仍缺：
  - 当前没有独立的正式头像资产管理，平台统一使用 deterministic 头像方案。
  - 若后续需要上传自定义头像，可单独作为上传链路设计，不和当前默认头像方案混在一起。
  直接下一步：
  - 继续把 deterministic 头像方案当作平台默认头像系统维护，若新增能力，优先考虑“上传头像”而不是“AI 生成图片”。
  - [x] 6.2.1 保留 deterministic 默认头像作为创建即有图的兜底方案
  - [x] 6.2.2 删除 AI 正式头像生成方向，统一回归 deterministic 头像方案
  - [x] 6.2.3 支持刷新 deterministic 头像并回写配置
  - [x] 6.2.4 已为 Supervisor 提供稳定的黑金卡面与黑金风格 deterministic 头像兜底

- [x] 6.3 Agent 通讯录与长期会话统一模型
  当前状态：已完成当前阶段目标。
  源码现状：
  - workflow 页已经支持 `workflow-chat`，会把 workflow 上下文传给 Agent。
  - chat sidebar 已展示当前工作流通讯录和已沉淀的工作流会话。
  - run state / workflow binding 里已经持久化 `supervisorSessionId` 与 `attachedAgentSessions`。
  - 首页、Agent 页、workflow 页现已共用 `src/lib/agent-conversations.ts` 的目录/会话解析层；workflow 页聊天入口也已切到共享 resolver。
  - Agent chat 接口已按 `workflow-chat` / `standalone-chat` 两种模式写入并读取不同 scope 的会话记忆。
  - 首页从 Agent 页发起的长聊已不再只是预填一段 starter prompt，而是会创建持久化的 `agentBinding` 会话，刷新后仍能恢复当前绑定角色，并直接走 `/api/agents/[name]/chat`。
  - 首页顶部与会话列表已能显式识别“当前正在和哪个 Agent 对话”，基础的入口语义和长期会话沉淀已经闭环。
  - 参考实现：`src/app/workbench/[config]/page.tsx`、`src/app/api/agents/[name]/chat/route.ts`、`src/components/chat/ChatSidebar.tsx`、`src/lib/state-machine-workflow-manager.ts`
  后续优化项：
  - 首页侧栏仍可继续补“继续该 Agent 最近会话”的更显式入口，减少页面跳转成本；这属于体验增强，不再阻塞统一会话模型收口。
  - workflow 运行中已绑定的 Agent / Supervisor 会话，后续仍需补“直接带着 run 上下文返回首页继续聊”的显式入口与头部状态展示。
  - [x] 6.3.1 workflow 页已支持与 Agent / Supervisor 进行带上下文对话
  - [x] 6.3.2 首页已能触发 Agent 创建与部分对话绑定联动
  - [x] 6.3.3 打通首页、Agent 页、workflow 页的统一通讯录模型
  - [x] 6.3.4 支持 workflow 结束后继续沿用相关 Agent 会话
  - [x] 6.3.5 收口 workflow-chat / standalone-chat 的长期会话沉淀与复用策略

- [x] 6.4 首页动态侧栏意图编排器升级
  当前状态：部分完成。
  源码现状：
  - 已有 `hidden / peek / active` 三态。
  - 已有 `home_sidebar` 结构化结果驱动，创建态/运行态会随 session binding 联动。
  - 已新增 `sessionWorkbenchState.homeSidebar` 持久化到 chat session，首页侧栏不再只依赖“消息解析后临时判断”，而是有独立会话状态承接。
  - 已新增 `inferHomeSidebarTab / inferHomeSidebarMode` 共享推导规则，首页本地 `tab/mode` 状态会优先按持久化 `sessionWorkbenchState` 和当前会话上下文恢复，不再散落多套页面级 fallback。
  - 首页普通文本 prompt 的正则侧栏推断已删除；当前只保留结构化 `home_sidebar`、显式界面动作和持久化状态驱动，不再新增“前端猜你意思”的推断层。
  - `home_sidebar` 已扩展 `intent/stage/knownFacts/missingFields/questions/recommendedNextAction/shouldOpenModal`，首页 prompt 也已改为重点要求 AI 在命中创建/运行意图时，把尽可能多的上下文整理给侧边栏与后续 workflow/OpenSpec 创建链路。
  - 创建类 `home_sidebar` 已开始抑制首页 card 双轨展示，避免“同一轮既弹侧边栏又吐创建卡片”。
  - 参考实现：`src/app/page.tsx`、`src/lib/chat-actions.ts`、`src/lib/home-sidebar-state.ts`、`src/components/chat/HomeCommandSidebar.tsx`
  仍缺：
  - 首页其他入口对 `sessionWorkbenchState` 的复用还可继续扩大，例如更多 run/result 详情面板与侧栏之间的联动。
  - workflow / agent / commander 三类面板虽然已开始共享状态源和共享推导规则，但还没有彻底抽成单独的 orchestrator 服务。
  直接下一步：
  - 继续把首页剩余的页面级 fallback 判断迁到统一 orchestrator，减少重复状态推导。
  - [x] 6.4.1 已支持侧栏按对话结果动态 hidden / peek / active
  - [x] 6.4.2 已支持创建态与运行态基本联动
  - [x] 6.4.3 已完成基础版会话意图编排；当前仍缺独立统一状态源
  - [x] 6.4.4 继续减少默认信息堆叠，强化“按需展示”的工作台语义
    当前已完成：首页 prompt 已明确把创建场景收口到侧边栏；侧栏顶部上下文区改为聚焦 `summary / knownFacts / missingFields / questions / recommendedNextAction`，减少无差别卡片堆叠。
  - [x] 6.4.5 让创建 workflow、启动 run、查看结果、Agent 创建等意图共享统一状态源
    当前已完成：`sessionWorkbenchState.homeSidebar` 已作为共享状态源落入 chat session，首页切 tab、创建 workflow、创建 Agent、运行与指挥官相关意图都会回写这份状态。

- [ ] 6.5 Supervisor 对话刷新 OpenSpec 闭环
  当前状态：部分完成。
  源码现状：
  - 创建态 OpenSpec 已支持 revisionSummary 持久化。
  - 运行态 Supervisor 已能维护 run OpenSpec revision。
  - Supervisor 的 `workflow-chat` 已支持 `<openspec-revision>` 结构化协议，能把 `summary / affectedArtifacts / impact` 落到 creation OpenSpec、run snapshot 和 `latestSupervisorReview`。
  - 参考实现：`src/components/NewConfigModal.tsx`、`src/app/api/openspec/sessions/[id]/route.ts`、`src/lib/openspec-store.ts`、`src/lib/state-machine-workflow-manager.ts`
  仍缺：
  - 结构化修订虽然已能落盘，但首页侧栏、workflow 页、更多 Supervisor 对话入口还没有统一高亮 `affectedArtifacts / impact`。
  直接下一步：
  - 把 `affectedArtifacts / impact` 从状态接口一路透出到所有相关 UI，并统一展示样式。
  - [x] 6.5.1 创建态 OpenSpec 已支持确认、修订与 revision 记录
  - [x] 6.5.2 运行态 Supervisor 已可维护 OpenSpec 状态与 revision
  - [x] 6.5.3 明确支持用户通过与 Supervisor 对话触发 OpenSpec 刷新/修订
    当前已完成：Supervisor 的 `workflow-chat` 已支持 `<openspec-revision>` 结构化协议；命中后会把修订落到 creation OpenSpec，并在存在 run snapshot 时同步写入运行态 OpenSpec。
  - [x] 6.5.4 页面显式展示“本轮由 Supervisor 刷新的修订记录”与影响范围
    当前已完成：workflow 页 OpenSpec 面板与首页侧栏都已统一展示 `chat-revision` 的摘要、`affectedArtifacts` 和 `impact`。
  - [x] 6.5.5 将该闭环统一到首页侧栏、workflow 页和 Supervisor 对话链路
    当前已完成：首页侧栏、workflow 页、Supervisor `workflow-chat` 修订落盘链路已经打通。

- [x] 6.6 workflow 启动前 lint / compile 检查链路
  当前状态：当前阶段完成。
  源码现状：
  - 已有统一 `workflow-preflight` 后端入口，首页侧栏 / workflow 页 / start API 都会在启动前执行。
  - preflight 结果会进入 run 级 `qualityChecks`，并在 workflow 页展示，不再只是临时启动提示。
  - 当 workflow 未显式配置 `preCommands` 时，系统已能按项目结构推断默认 `lint / build / typecheck / cjpm build` 等检查。
  - 最近一次 preflight 摘要会写入 chat session 的 `sessionWorkbenchState`，首页侧栏刷新后仍能恢复目标 workflow、通过/失败状态、warning 数和推断命令信息。
  - 参考实现：`src/lib/workflow-preflight.ts`、`src/app/api/workflow/preflight/route.ts`、`src/app/api/workflow/start/route.ts`、`src/app/workbench/[config]/page.tsx`、`src/components/chat/HomeCommandSidebar.tsx`
  - [x] 6.6.1 在 workflow 启动前统一执行 lint / compile / 自定义检查
  - [x] 6.6.2 将检查结果绑定到 run 启动流程，而不是运行后才看到
  - [x] 6.6.3 首页侧栏与 workflow 页展示启动前检查结果
  - [x] 6.6.4 明确失败阻断、警告放行、人工确认等策略
    当前已完成：preflight 已明确 `blockOnFailure=true`、`allowOnWarning=true` 的策略返回；workbench / 首页启动时，失败会直接阻断，warning 会先弹出确认对话框，由用户显式确认后才继续启动。

- [ ] 6.7 经验库结构化沉淀与回流
  当前状态：部分完成。
  源码现状：
  - final review、scoreCards、experience 已落盘到 run 目录与 `experience-library`。
  - 已支持按 `configFile / workflowName / requirements / projectRoot / agentName` 召回相关经验，而不只是精确命中 `configFile`。
  - 运行态 Supervisor prompt、workflow AI 生成、Agent AI 草案、OpenSpec 修订链路都已接入相关经验回流。
  - 参考实现：`src/lib/workflow-experience-store.ts`、`src/app/api/workflow/status/route.ts`、`src/lib/state-machine-workflow-manager.ts`
  仍缺：
  - 经验库目前主要还是“召回后展示 / 注入 prompt”，还没有更强地自动反馈到 OpenSpec / YAML 编排决策。
  直接下一步：
  - 继续把经验回流从“提示建议”升级成更强的自动编排采纳依据。
  - [x] 6.7.1 工作流结束后已有 Supervisor review / score / experience 基础数据
  - [x] 6.7.2 已将经验沉淀为结构化经验库基础文件，而不只是页面展示
  - [x] 6.7.3 在创建 workflow / OpenSpec 阶段注入相关历史经验
  - [x] 6.7.4 在运行态 Supervisor 修订 OpenSpec 时注入相关历史经验
  - [ ] 6.7.5 将经验反向用于 Agent 创建推荐与编排推荐
    当前已完成：Agent 创建推荐已注入相关经验；workflow 创建态已开始把经验库回流到编排推荐面板。
    仍缺：把这些推荐进一步自动反馈到 OpenSpec / YAML 编排决策。

- [x] 6.11 Creator 机制内建化
  当前状态：已完成当前阶段收口。
  源码现状：
  - `aceharness-agent-creator` / `aceharness-workflow-creator` 已从仓库删除，运行时技能发现链路也不再依赖额外过滤兜底。
  - Agent / workflow 的核心校验已开始迁入系统内建 `src/lib/creator-validation.ts`，保存 Agent、保存 workflow、Agent AI 草案、workflow 创建落盘、OpenSpec 预览构建都会走内建 validator，而不是依赖 skill 脚本。
  - workflow validator 已补入旧脚本中的关键运行规则：`projectRoot`、Agent 引用、Supervisor 引用、状态机初始/终止状态、终止状态转移警告、转移目标存在性、重复状态名等。
  - 首页 `CORE_PROMPT` 已改为只强调“何时调起侧边栏、要带哪些上下文”；creator 行为已转成系统机制，不再依赖 creator skill 文档注入。
  - OpenSpec 预览页已显式展示 workflow 草案 validator 结果，Agent 创建弹框也能看到系统 validator 的错误/警告。
  - 旧 creator skill 的模板/脚本能力已迁移或删除，平台改为依赖内建默认草案与校验逻辑。
  - 参考实现：`src/lib/creator-validation.ts`、`src/app/api/agents/[name]/route.ts`、`src/app/api/configs/[filename]/route.ts`、`src/app/api/configs/create/route.ts`、`src/app/api/agents/ai-draft/route.ts`、`src/app/api/openspec/ai-draft/route.ts`、`src/components/AIAgentCreatorModal.tsx`、`src/components/NewConfigModal.tsx`、`src/lib/chat-settings.ts`、`src/lib/chat-system-prompt.ts`、`src/app/api/auth/setup/route.ts`
  - [x] 6.11.1 移除 creator skill 的首页默认启用与提示词注入依赖
  - [x] 6.11.2 将 Agent / workflow 基础 validator 内建到系统
  - [x] 6.11.3 让 AI 草案链路能够拿到系统 validator 结果
  - [x] 6.11.4 完成旧 creator skill 剩余模板/脚本能力迁移后删除目录

- [x] 6.8 记忆分层实现
  当前状态：已完成基础多层记忆闭环。
  源码现状：
  - 已新增 `src/lib/workflow-memory-store.ts`，独立存储 `role / project / workflow / chat` 四类 scope。
  - workflow status 已返回 `schema / role / project / workflow / chat / recalledExperiences`。
  - Agent chat 已按模式读取与写入记忆，并明确单次聊天上下文只写 `chat` scope、不会直接提升成长期事实。
  - 参考实现：`src/lib/workflow-memory-store.ts`、`src/app/api/workflow/status/route.ts`、`src/app/workbench/[config]/page.tsx`、`src/app/api/agents/[name]/chat/route.ts`
  - [x] 6.8.1 已有部分 runtime / review / history 数据分层展示
  - [x] 6.8.2 明确角色长期记忆层
  - [x] 6.8.3 明确项目级共享知识层
  - [x] 6.8.4 明确 workflow 运行时记忆层
  - [x] 6.8.5 明确单次聊天上下文边界与注入策略
  - [x] 6.8.6 避免跨 run / 跨角色污染的统一记忆读取与写入约束

- [ ] 6.9 Agent 关系系统与编队推荐
  当前状态：部分完成。
  源码现状：
  - 已有 `src/lib/agent-relationship-store.ts`，包含 relationship schema、关系文件持久化、协作分数、强项、最近 run/config 等字段。
  - workflow final review 后会基于 scoreCards 调用 `upsertRelationshipSignal`，沉淀 Agent 两两协作信号。
  - 创建 workflow / OpenSpec 阶段已经开始展示关系推荐与参考骨架，但仍以提示和注入 prompt 为主。
  - 参考实现：`src/lib/agent-relationship-store.ts`、`src/lib/state-machine-workflow-manager.ts`
  直接下一步：
  - 将 `listAgentRelationships` 和经验库召回接入创建 workflow / OpenSpec 阶段，让编排推荐能主动选择协作关系更好的 Agent 组合。
  - [x] 6.9.1 建立 Agent 关系数据模型
  - [x] 6.9.2 基于历史协作结果沉淀关系强弱
  - [ ] 6.9.3 在创建 workflow / OpenSpec 阶段提供编队推荐
    当前已完成：`NewConfigModal` 会根据参考 workflow 的角色骨架和历史协同关系展示高协同编队提示，并已把这些推荐显式注入 AI 引导创建 workflow 的 prompt。
    仍缺：非 AI 引导路径下更强的自动采纳。
  - [ ] 6.9.4 将关系系统与经验库联动
    当前已完成：final review scoreCards 会沉淀关系信号；创建期推荐接口已同时召回经验库与关系库并在 UI 中联合展示，且会继续注入 AI 创建 prompt。
    仍缺：基于联合结果做更强的自动推荐排序与采纳。

- [ ] 6.10 演练模式
  当前状态：部分完成。
  源码现状：
  - 已新增 workflow start 的 `rehearsal` 启动参数；workbench 启动区也已增加“演练模式”开关。
  - 演练模式会创建独立 run，但不执行真实项目改动，只产出推演总结、推荐下一步和运行态 OpenSpec 快照。
  直接下一步：
  - 继续把演练结果转正式启动的入口做得更显式，并视需要补首页入口。
  - [x] 6.10.1 支持只生成 OpenSpec / workflow 草案而不执行真实项目改动
  - [x] 6.10.2 区分演练模式与真实执行模式的 UI 和运行状态
  - [x] 6.10.3 允许用户基于演练结果继续转入真实 workflow
    当前已完成：workbench 的演练总结面板已提供“基于演练结果正式启动”入口，可直接关闭演练模式并复用当前配置继续正式启动。
