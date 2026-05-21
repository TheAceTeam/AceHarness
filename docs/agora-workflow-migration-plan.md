# 议场与工作流群聊迁移计划

## 目标

把首页的「对话 / 议场 / 工作流」统一成三类清晰入口：

- 对话：一对一普通聊天。
- 议场：内置多人群聊能力，承载普通议题、工作流协作议题和狼人杀扩展。
- 工作流：工作流目录与运行入口；工作流协作议题仍显示在工作流目录里，打开后右侧呈现为议场群聊，而不是多层内部会话树。

最终用户看到的是「真实群聊」。工作流内部仍保留结构化状态、事件和审计数据，但不再把阶段 tag 或内部调度 tag 直接显示为聊天记录。

## 当前结论

- 议场已经有内置 `AgoraShell` 和左侧议题列表；首页侧栏里的旧 `chatroom/议场` 插件 tab 已切掉。
- `src/plugins/chatroom/*` 已删除，议场执行面板迁到 `src/components/collaboration/agora`。
- `src/lib/roundtable` 已删除；当前代码里不再保留 `Roundtable/roundtable/圆桌/剧场` 命名。
- 狼人杀已从首页/sidebar 插件注册里移除，并通过议题列表扩展动作创建。
- 新启动的工作流会创建或升级为协作议题，并继续显示在「工作流」目录下。
- 工作流阶段/状态/步骤、人工问答、审批流转和运行结束事件会投影为议场嘉宾/用户发言；旧群聊入口已硬切。
- 议场普通嘉宾调用已改为 `temporaryLab: 'agora'`，狼人杀仍使用 `temporaryLab: 'werewolf'`。

## 产品模型

### 1. 工作流运行 = 一个议题

每个 workflow run 创建或绑定一个议场议题。这个议题的目录归属仍是「工作流」，不要混进普通「议场」列表：

- 议题标题：`工作流名 · runId短码`，未命名时用配置文件名。
- 参与嘉宾：创建态 agent、工作流步骤 agent、原 Supervisor agent 在议场里显示为「协调型嘉宾」。
- 工作目录：沿用议场 workspace，嵌入 `workspace / changes` tab。
- 文件变化：显示在议场变更 tab，不再散落到工作流多层会话里。
- 人工确认、失败、重试、阶段切换：作为群聊消息呈现，同时结构化保存在 run/event store。

### 2. 创建态也进入群聊

工作流创建过程中的 agent/session 不再独立漂浮在工作流目录里。它应成为同一议题的早期上下文：

- 创建草案、用户确认、配置修订，进入同一个议题 transcript。
- 工作流真正启动后，继续使用同一议题或派生同名运行议题。
- 创建态 agent 作为嘉宾保留，方便解释「为什么这个工作流被这样设计」。

### 3. 多人协作并入议场群聊

多人协作不再有独立旧模式：

- 删除旧的中心化控场概念。
- 用户消息就是群聊里的用户发言，右侧显示。
- 被 @ 的嘉宾接话；没有 @ 时可按议题模式选择默认响应策略。
- 新运行只写议场 topic message/round。
- 微信等渠道的普通文本直接进入当前工作流协作议题。

## 阶段事件话术化

工作流内部仍保存结构化事件，例如：

- phase_started
- step_started
- step_completed
- waiting_for_human
- retry_requested
- failed
- completed

但聊天记录里显示为对应嘉宾自动生成的发言，而不是 tag。

### 示例

- 工程师：我开始处理「实现接口」这一步，先看当前代码结构和依赖。
- 架构师：实现阶段已经收束，我来检查一下方案和边界有没有偏移。
- 测试：这一步完成了，我接下来补一轮验证点，重点看回归风险。
- 产品经理：这里需要你确认一下需求取舍，我先把两个选项列出来。
- 代码评审：刚才的改动已经落地，我开始检查命名、边界和潜在回归。

### 话术策略

- 使用固定模板池，按 `runId + eventId + agentName` 做稳定随机。
- 只在关键事件生成消息，避免刷屏。
- 允许轻量前后互动，例如「架构师交给工程师」「测试接工程师的实现结果」。
- 结构化状态是事实来源，自然语言消息只是展示层。

## 数据设计建议

新增或收敛到一个工作流议题绑定结构：

```ts
interface WorkflowAgoraBinding {
  runId: string;
  configFile: string;
  agoraSessionId: string;
  topicId?: string;
  guestIds: string[];
  creationSessionIds?: string[];
  internalAgentSessionIds: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}
```

消息建议分两层：

- `workflow events`：结构化事件，用于恢复、审计、状态机和断点续跑。
- `agora messages`：用户可见群聊 transcript，可由事件投影生成或持久化缓存。

## 议场收尾任务

- [x] 删除 `src/plugins/chatroom/index.ts` 的插件注册和 intent handler。
- [x] 将 `ChatroomPanel` / `types` 移到 `src/components/collaboration` 或 `src/lib/agora`，避免继续以 plugin 命名暴露。
- [x] 确认首页快捷操作、插件 registry、intent 列表里不再出现旧插件入口。
- [ ] 保留左侧 `批量管理议题`，不要变成嘉宾管理。
- [ ] 空议题状态保持在议场，不回退到对话模式。
- [x] 嘉宾不可用时明确显示原因，不能默认创建成功。
- [x] 议场 workspace 默认创建在 runtime 数据目录下，非 git 目录自动初始化 `.git`。
- [x] 议场 workspace 内处理 skills 链接；Windows 下 symlink 失败时复制兜底。

## 狼人杀集成任务

- [x] 从 `src/lib/sidebar-plugins/registry.ts` 移除 `werewolfPlugin` 默认注册。
- [x] `src/plugins/werewolf/index.ts` 不再作为首页/sidebar plugin，只保留规则、角色、资源和扩展元数据。
- [x] 狼人杀通过议题列表三点菜单的扩展动作创建，不在 `AgoraShell` 主线增加独立扩展 tab。
- [x] 狼人杀创建状态留在 `plugins/werewolf` 扩展模块中，议场侧栏只消费通用扩展动作。
- [x] 狼人杀玩家使用「嘉宾」模型，而不是普通 agent 列表。
- [x] 去掉狼人杀 UI 中的 Supervisor/控场文案，改成系统回合推进或场内事件。
- [ ] 狼人杀消息进入同一个议场 transcript，并继续支持身份视角、夜晚私密信息和历史回放。

## 工作流迁移任务

- [x] 新增 workflow run 到 agora topic 的绑定层。
- [x] 工作流启动时创建或复用一个议场议题。
- [x] 将创建态 agent/session 加入议题嘉宾列表。
- [x] 将 workflow 协调 agent 转为协调型嘉宾，不再作为 UI 上的控场角色。
- [x] 阶段开始、阶段结束、状态开始、状态结束、步骤开始、步骤结束、等待人工、人工回复、失败、审批流转等事件投影为嘉宾或用户发言。
- [x] 首页工作流 tab 改成工作流目录；点击运行记录直接打开对应议场议题，目录归属仍留在工作流。
- [x] 删除或隐藏工作流目录下协调 / Agent / 创建 / 运行的多层会话树。
- [x] `StateMachineExecutionView` 的协作 tab 改为「协作议题」或直接跳转到议场。
- [ ] `HomeCommandSidebar` 里的旧多人执行逻辑迁移到议场主输入框，不保留旧入口。
- [x] 旧多人协作模块从新流程移除，停止作为新写入路径。
- [x] 渠道不再处理旧特殊群聊命令。

## 实施顺序

1. 先切掉旧插件入口：chatroom plugin、werewolf plugin 不再出现在首页插件体系。（已完成）
2. 稳定议场核心：嘉宾、workspace、changes、输入框、消息布局、批量议题管理。
3. 把狼人杀接为议场扩展，但先保持现有规则引擎可用。
4. 建 workflow-agora binding，让新 workflow run 能生成一个群聊议题。
5. 把工作流事件投影为嘉宾发言，替代 tag 记录展示。
6. 收敛首页工作流目录，移除多层 Supervisor/Agent 会话树。
7. 删除旧多人协作数据和渠道命令入口。

## 剩余代码量评估

截至 2026-05-21，剩余工作按需要触碰的代码量估算：

- 狼人杀从首页侧栏 / Supervisor 面板解耦为议场扩展运行器：约 2500 到 4000 行触碰量。主要是把 `HomeCommandSidebar.tsx` 中的狼人杀状态机、提示词、投票结算、私密视角、历史记录和 `CommanderPanel.tsx` 中的狼人杀 UI 移到扩展模块。净新增不应太多，目标是搬迁后从首页侧栏减少约 1500 到 2500 行。
- 议场内部 `chatroom` 类型命名收敛为 `agora topic`：约 800 到 1400 行触碰量。这里涉及持久化字段，建议先保留数据字段兼容，优先改类型、函数和非持久化变量名；不要急着迁移历史数据结构。
- 工作流 Supervisor 接入议场的收尾：主体已完成。剩余主要是补测试断言，以及观察旧 phase-based 工作流的实时反馈/重试按钮是否需要更细粒度群聊事件。
- 议场 workspace / skills / git 初始化收尾：约 300 到 600 行触碰量。重点是 Windows symlink 失败时复制兜底、默认 runtime 临时目录、非 git 目录初始化 `.git`。
- 测试与断言更新：约 200 到 500 行触碰量。重点覆盖首页不暴露狼人杀、议题扩展创建狼人杀、workflow topic 投影、opening line、普通议场消息能力。

合计剩余约 4100 到 7100 行触碰量，其中真正新增代码预计 800 到 1800 行，其余主要是迁移、删除和测试同步。

## 风险点

- 不能把自然语言 transcript 当作唯一事实来源，否则断点恢复和审计会变脆。
- 旧多人协作、微信渠道、workflow run status、HomeCommandSidebar 之间耦合较深，需要分阶段硬切。
- 狼人杀有私密视角和角色状态，接入议场时不能简单当普通群聊处理。
- 插件入口删除后，测试里对 QuickActions 和 plugin registry 的断言需要同步更新。
