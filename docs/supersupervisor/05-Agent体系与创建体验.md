# 05 Agent 体系与创建体验

对应总纲：27.4，以及角色化改造的配套部分

## 目标

Agent 相关改造的目标不是单独把 Agent 页面做漂亮，而是让 Agent 在整条体验链中成为真正可被选择、分工、对话、复用的角色实体。

主要包括：

1. Agent 管理页角色化
2. Agent 创建体验统一
3. 创建 workflow 时能感知可用 Agent
4. 运行过程中与 Agent / Supervisor 保持连续对话
5. 头像体系从 deterministic 预览逐步过渡到正式头像生成

## 当前代码现状

已完成：

1. Agent 管理页和 Agent 创建入口已经存在，见 [src/app/agents/page.tsx](/usr1/ace/cangjie_frontend_ace/src/app/agents/page.tsx)。
2. AI Agent 创建 modal 已存在，见 [src/components/AIAgentCreatorModal.tsx](/usr1/ace/cangjie_frontend_ace/src/components/AIAgentCreatorModal.tsx)。
3. 首页侧栏里已经有 Agent 创建入口，见 [src/components/chat/HomeCommandSidebar.tsx](/usr1/ace/cangjie_frontend_ace/src/components/chat/HomeCommandSidebar.tsx)。
4. workflow 页面已有 AgentPanel、AgentConfigPanel、AgentHeroCard 等角色展示基础，见 [src/app/workbench/[config]/page.tsx](/usr1/ace/cangjie_frontend_ace/src/app/workbench/[config]/page.tsx)。
5. workflow 页面已能直接和具体 Agent 对话，且默认带当前 workflow / step / 运行态 / `OpenSpec` 上下文，见 [src/components/AgentPanel.tsx](/usr1/ace/cangjie_frontend_ace/src/components/AgentPanel.tsx) 与 [src/app/api/agents/[name]/chat/route.ts](/usr1/ace/cangjie_frontend_ace/src/app/api/agents/[name]/chat/route.ts)。

未完成：

1. 首页创建 Agent 和 Agent 管理页创建 Agent 还不是一套统一状态机。
2. 创建 workflow 时还没有稳定的 Agent 推荐/分工链路。
3. Agent 持续聊天与 workflow-chat 已经开始收口到统一上下文模式，但会话复用、通讯录和长期沉淀仍未完全成型。
4. Agent 画像、头像、称号、稀有度这些角色化表达还没有真正成为主视觉体系。
5. 正式头像生成链路仍未落地，目前更接近 deterministic 预览优先。

## 代码仓判断

Agent 体系当前是“入口很多，体验尚未收口”。

优点：

1. 已有多处入口
2. 已有可复用组件
3. 已有 AI 创建链路

缺点：

1. 入口之间仍不统一
2. 和 workflow 创建还没有真正串起来
3. 和首页侧栏虽已发生联动，但仍未成为同一状态机下的一致体验

## 已完成部分

1. Agent 创建能力已具备
2. Agent 展示组件有基础
3. 运行页内的 Agent 面板已存在
4. workflow-context Agent chat 已可用

## 未完成部分

1. 创建态 Agent 分工推荐
2. Agent 创建流程统一收口
3. Agent 长期对话会话模型
4. Supervisor 与普通 Agent 的角色层级表达
5. AI 正式头像生成与替换链路

## 改进项

1. 把首页侧栏和 Agent 页的创建入口收敛成同一套表单/状态流。
2. 在 workflow 创建阶段加入“候选 Agent 推荐 + 分工建议”。
3. 把 Agent 会话分成：
   - 独立角色聊天
   - run 上下文聊天
4. 在 UI 上更明确区分 Supervisor 和普通 Agent 的视觉层级。
5. 等创建态设计对象落地后，再把 Agent 推荐建立到设计目标、约束、阶段分工上。
6. 把头像能力拆成两层：
   - deterministic 预览即时可用
   - 正式头像异步生成后可回填替换

## 优先级判断

这部分很重要，但不是当前第一阻塞。

先决条件是：

1. 创建态主链收口
2. 首页侧栏双态联动
3. run 级 supervisor 视图统一

在这些完成后，Agent 体系的收口才会真正有抓手。
