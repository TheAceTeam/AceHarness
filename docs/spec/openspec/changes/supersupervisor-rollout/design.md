# Design: SuperSupervisor rollout

## Technical Approach

本次改造采用“双层 OpenSpec”：

1. 官方 OpenSpec 文档制品作为研发规范源
2. 项目内部 `OpenSpecDocument` 作为创建态 / 运行态的执行承载体

这样可以避免把运行时对象和文档规范混为一谈。

## Key Decisions

### Decision: 官方 OpenSpec 放在 `docs/spec/openspec/`

原因：

- 用户已明确要求放在 `docs/spec`
- 不与仓库现有运行时代码目录混淆
- 便于和现有设计文档一起维护

### Decision: workflow 创建与 OpenSpec 解耦但串联

原因：

- workflow creator 负责配置建模与校验
- openspec skill 负责 proposal/design/tasks/specs 制品
- 两者职责边界更清晰

### Decision: workflow 页 Agent 对话保持单一路径

原因：

- 当前用户已明确要求任何场景都不要屏蔽 workflow 上下文
- 因此不再继续扩展 standalone chat 分支

### Decision: 运行态 spec 修改权限分层

原因：

- 每个步骤最清楚自己的执行状态，状态更新应允许就地回写
- 目标、约束、阶段、分工等非状态内容属于全局设计语义，不能由普通步骤随意修改
- 因此运行态需要明确区分“状态更新权”和“结构修订权”，后者由 Supervisor 统一负责

### Decision: 每次 run 使用独立 spec 快照

原因：

- 同一个 workflow 配置可能被多次运行
- 若多个 run 共用同一份运行态 spec，会导致修订历史和进度互相污染
- 因此 run 启动时应从创建态基线派生独立 snapshot

### Decision: 以 prompt 契约约束 spec 读写边界

原因：

- 当前 AI 是否遵守 spec 读写边界，最终取决于系统注入了什么上下文与规则
- Supervisor 和普通 Agent 的职责不同，必须在 prompt 中显式区分
- 这样才能让“步骤只改状态，Supervisor 改其他内容”变成可执行约束

### Decision: workflow YAML 与内部 spec 分层映射

原因：

- YAML 负责执行结构，内部 spec 负责设计补充、运行进度和修订历史
- 若不明确映射关系，后续会持续出现 source of truth 混乱
- 需要在系统中明确哪些字段从 YAML 派生，哪些字段只存在于 spec

## Affected Areas

- `skills/openspec/`
- 平台内建 workflow 创建与校验机制（已替代旧 workflow creator skill）
- `docs/spec/openspec/`
- `docs/角色化Agent与全局Supervisor改造设计.md`
- `docs/supersupervisor/*`
- `src/lib/openspec-store.ts`
- `src/app/api/openspec/...`
- `src/app/page.tsx`
- `src/components/chat/HomeCommandSidebar.tsx`
- `src/app/workbench/[config]/page.tsx`
- `src/components/AgentPanel.tsx`
- `src/lib/default-supervisor.ts`
- 运行态步骤执行与 spec 回写链路
- run 启动时的 spec snapshot 派生链路
- Supervisor / Agent prompt 注入链路
- workflow YAML 到内部 spec 的派生规则

## Risks And Tradeoffs

1. 若官方 OpenSpec 文档和内部 `OpenSpecDocument` 不同步，后续会再次出现双口径问题。
2. 若 workflow creator 不强制在 spec-first 场景下先走 openspec skill，仍可能回退成“纯靠描述直接生成 YAML”。
3. 当前首页侧栏已经具备动态触发基础，但信息编排仍偏粗，需要后续在实现阶段继续收口。
4. 若运行态没有明确权限分层，普通步骤可能误改本应由 Supervisor 控制的 spec 内容。
5. 若 run 不做 spec snapshot 隔离，多次运行会共享同一份运行态语义，难以追溯。
6. 若 prompt 注入契约不明确，Agent 虽然拿到了上下文，也不一定会按 spec 权限模型工作。
