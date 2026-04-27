# ACEHarness 角色化 Agent 与全局 Supervisor 改造设计

> 版本：v0.3  
> 日期：2026-04-23  
> 状态：设计草案

## 一、目标

本次改造的目标不是单独优化某一个页面，而是把当前偏“后台管理”的多 Agent 工作台升级为“角色化协作系统”。

核心目标如下：

1. Agent 从“配置项”升级为“角色化实体展示”。
2. 工作流内外都可以与 Agent 对话，Supervisor 也成为可对话角色。
3. 状态机模式默认带有 Supervisor 机制，且不再依赖特定 Agent 的 prompt 注入。
4. 规划能力以前移的 `OpenSpec` 形式升级为平台能力，所有 engine 类型都消费同一套制品。
5. 工作流结束后由 Supervisor 对所有 Agent 评分，并沉淀跨工作流共享经验。
6. 将 Agent / Workflow 创建器从 Skill 形态收口为平台内建机制，统一承载草案生成、校验与落盘。
7. 将经验库、评分、编排推荐、workflow 检查器、记忆分层纳入同一轮改造。
8. 将“创建 workflow、生成 `OpenSpec`、绑定指挥官、启动 workflow、查看进度、接收汇报”收敛成首页聊天页的内建能力。
9. 改造顺序必须先补基础能力，再改首页交互，避免首页出现没有真实后端支撑的空壳 UI。

---

## 二、改造范围

本次设计覆盖以下模块：

1. Agent 配置模型与管理页面
2. Agent 头像系统
3. Agent 创建机制
4. Workflow 页面中的 Agent 对话能力
5. 首页聊天页右侧指挥官边栏
6. 状态机工作流默认 Supervisor 机制
7. `OpenSpec` 机制平台化
8. 人工检查点中的 Supervisor 建议与对话
9. 工作流结算页中的 Agent 评分
10. 全局经验库与跨工作流共享
11. Agent 关系系统与编队推荐
12. Workflow lint / compile 检查器
13. 记忆分层与上下文边界
14. 指挥官定时进度汇报
15. 演练模式
16. 首页自动编排绑定与运行态关联
17. Agent 相关 GitCode 能力移除
18. 引导卡片与侧栏交互收敛

---

## 三、最终产品形态

### 3.1 Agent 管理页

当前 Agent 管理页更像配置后台。改造后应变成“角色大厅”或“英雄选择页”。

页面应具备：

1. 大卡片式角色展示，而不是表格或表单列表。
2. 每个 Agent 具备头像、阵营色、角色化卡面和强风格视觉表达。
3. 支持 AI 引导创建 Agent。
4. 支持手动编辑 Agent 的角色设定和执行能力。
5. 默认突出显示 Supervisor 卡片，使用黑金“指挥官”视觉体系。

### 3.2 Workflow 页面

工作流页面左下角 Agent 标签页升级为“工作流通讯录”。

页面应具备：

1. 当前 workflow 中所有 Agent 的可见列表。
2. 不在工作中的 Agent 也可直接发起对话。
3. Workflow 结束后仍可继续与这些 Agent 对话。
4. Supervisor 始终存在，且始终可对话。
5. 聊天支持两种语义：
   - 普通角色聊天
   - 带当前 workflow 上下文的工作聊天

### 3.3 首页聊天页右侧指挥官边栏

不建议再单独做一个与首页对话割裂的“驾驶舱页面”。更合适的做法是将其内建到首页聊天页的右侧边栏。

右侧边栏最终应具备：

1. 当前自动关联的 workflow 运行记录
2. 当前运行绑定的 supervisor / 指挥官
3. workflow 状态与当前阶段
4. 可直接跟指挥官对话
5. 指挥官定时汇报进度
6. 当前风险和下一步建议
7. 一键创建 workflow
8. 一键启动 workflow
9. 自动切换到最近一次有效运行的 supervisor 会话

重要约束：

1. 首页不应要求用户手动“绑定工作流”。
2. 当用户在首页通过引导创建 workflow / agent，或从首页启动 workflow 后，系统应自动完成关联。
3. 侧栏展示的应是“当前对话上下文关联的 workflow 运行态”，而不是静态配置绑定。
4. 侧栏不应是固定常驻的“后台控制面板”，而应根据当前对话语义动态弹出、切换与绑定。

这样“创建工作流、绑定指挥官、启动工作流、观察进度、获取建议”就会变成首页聊天页的稳定内建能力，而不是依赖纯对话加卡片拼装。

### 3.3.1 动态侧栏原则

首页右侧侧栏应被定义为“对话驱动的动态工作台”，而不是固定模式的静态边栏。

它的核心行为应为：

1. 根据用户当前消息语义决定是否弹出侧栏
2. 根据当前消息意图切换到最合适的面板
3. 根据当前会话上下文自动绑定最近相关的 workflow / run / supervisor / agent
4. 当语义结束或上下文失效时自动降级回摘要态，而不是永久停留在某个固定面板

建议将首页消息意图粗分为以下几类：

1. `create-workflow`
   - 用户表达“创建 workflow / 设计流程 / 生成流程草案”
   - 侧栏自动切到“创建工作流”面板，并在需要时拉起完整 modal

2. `run-workflow`
   - 用户表达“启动 workflow / 运行这个流程 / 继续上次运行”
   - 侧栏自动切到“启动与绑定”或“当前 workflow”面板
   - 自动关联最近一次相关 run

3. `ask-supervisor`
   - 用户表达“问指挥官 / 当前进展 / 风险是什么 / 下一步怎么做”
   - 侧栏自动切到“指挥官”面板
   - 优先绑定当前会话最近关联的 supervisor session

4. `create-agent`
   - 用户表达“创建 Agent / 生成角色 / 配一个新的协作角色”
   - 侧栏自动切到“创建Agent”面板

5. `inspect-result`
   - 用户表达“看一下这个 workflow / 查看最近结果 / 看评分或总结”
   - 侧栏自动切到摘要或详情面板，并定位到对应 run / final review / experience

6. `plain-chat`
   - 普通闲聊或与当前控制流无关的对话
   - 侧栏不强制打断，只保留轻量摘要态或隐藏态

动态侧栏必须满足以下绑定规则：

1. 绑定对象优先来自当前 chat session 已关联的 workflowBinding
2. 若当前 session 无绑定，则尝试匹配最近一次由该会话创建、启动或继续的 workflow run
3. 若仍无运行态，则退回到最近一次有效的 workflow 配置或 supervisor 默认态
4. 一旦用户在侧栏中启动、创建、继续执行，必须立即回写当前 session 绑定关系

交互上建议区分三种显示态：

1. `hidden`
   - 无明确工作流语义时默认可收起

2. `peek`
   - 检测到弱相关语义时，仅显示一张摘要卡或轻量建议

3. `active`
   - 检测到强相关语义时自动展开，并进入目标面板

这样侧栏才是“随着对话流转而变化的工作台”，而不是一个永远固定在右边、需要用户自己理解和维护状态的控制台。

### 3.3.2 创建会话与运行侧栏联动

`OpenSpec` 前移到创建 workflow 阶段后，首页右侧侧栏必须明确区分“创建会话”和“运行会话”两种联动态。

建议拆成两类状态源：

1. `workflow creation session`
   - 与首页当前创建对话绑定
   - 承载需求澄清、方案设计、`OpenSpec` 生成与修订
   - 此时侧栏展示的是 `OpenSpec` 草案状态，而不是某次运行中的 Supervisor

2. `run supervisor session`
   - 在 workflow 启动后创建
   - 与 `runId` 绑定
   - 每次 run 都有独立的 Supervisor session
   - 此时侧栏展示的是本次运行的 Supervisor、run 状态、`OpenSpec` 执行进度

首页侧栏联动应遵守以下切换规则：

1. 当用户仍处于 workflow 创建阶段时
   - 侧栏优先展示 `OpenSpec` 草案
   - 展示需求摘要、阶段草案、Agent 分工建议、待确认项

2. 当用户点击启动 workflow 后
   - 系统创建独立的 run supervisor session
   - 侧栏从“创建态”切换到“运行态”
   - 自动将创建期已确认的 `OpenSpec` 绑定到该 run

3. 当 workflow 正在运行时
   - 侧栏优先展示 run 级 Supervisor 视图
   - 同时展示 `OpenSpec` 当前进度、阶段状态、风险与最近一次修订

4. 当 workflow 运行结束后
   - 侧栏仍可查看该 run 的 Supervisor 会话
   - 也可切回创建期 `OpenSpec` 历史，查看最初设计与最终执行差异

因此首页侧栏不能只绑定“一个 supervisor”，而应能在以下对象之间切换：

1. 创建期 `OpenSpec` 会话
2. 当前运行中的 Supervisor 会话
3. 已结束运行的 Supervisor 历史会话

这样才能保证：

1. 创建阶段不被误解释为“Supervisor 已经开始运行”
2. 每次 run 的 Supervisor 都是独立上下文
3. `OpenSpec` 既能在创建期被编辑，也能在运行期被跟踪
4. 首页侧栏始终有稳定状态源，不会退化成零散卡片拼接

### 3.4 首页集成式 AI 创建体验

首页聊天页不应只有沉浸式聊天框，还应内建“引导式创建模式”。

建议把当前已有的“AI 引导创建工作流”体验抽象出来，并集成到首页右侧边栏，用统一的引导式面板承载：

1. AI 引导创建 workflow
2. AI 引导创建 agent
3. 生成并确认 `OpenSpec`
4. 绑定 supervisor
5. 启动 workflow
6. 查看 lint / compile 结果

关键点不是把所有操作塞进聊天文本里，而是保留类似当前独立创建页的 UI 引导感。

补充约束：

1. 创建 workflow 的完整流程保持 `modal` 形态，不改成轻量 `popover`。
2. `popover` 只适合轻确认，例如 onboarding 中的“跳过引导”。
3. 首页侧栏适合做“状态、摘要、快捷操作、详情抽屉入口”，不适合承载完整 workflow 创建主流程。

因此首页创建能力建议采用两层：

1. 侧栏内触发
2. 正式创建流程进入 modal
3. `OpenSpec` 先生成、确认、再派生 workflow 草案
4. 结果回写首页当前上下文
5. 自动关联创建出的 workflow / agent / supervisor / openspec

这样首页会变成“聊天驱动的控制台”，而不是“纯聊天框”。

### 3.4.1 OpenSpec 作为 workflow 的统一承载体

本轮改造不再保留运行时临时规划问答，而是以前移的 `OpenSpec` 作为整个 workflow 的统一承载体。

建议流程改成：

1. 用户提出需求
2. Supervisor 或创建向导收集并澄清需求
3. 生成 `OpenSpec`
4. 用户确认或修订 `OpenSpec`
5. 基于 `OpenSpec` 选择 Agent、划分阶段、生成 workflow 草案
6. workflow 启动后所有 Agent 都感知同一个 `OpenSpec`
7. 运行中由 Supervisor 跟踪、刷新、维护 `OpenSpec`

`OpenSpec` 至少应包含：

1. 目标与非目标
2. 范围与约束
3. 方案设计摘要
4. 阶段划分
5. 各阶段负责 Agent
6. 输入输出约定
7. 风险与依赖
8. checkpoint 与人工决策点
9. 验收标准

### 3.5 状态机模式

所有状态机 workflow 默认启用 Supervisor 机制。

状态机执行中：

1. 默认挂载一个 Supervisor Agent。
2. 每个大阶段结束后，Supervisor 可阅读阶段结果并给出指导意见。
3. Supervisor 基于当前 `OpenSpec` 跟踪实际执行，并在偏离时给出修订建议。
4. 人工检查点弹窗支持“征询 Supervisor 意见”和直接对话。
5. 运行时基于已确认的 `OpenSpec` 做阶段推进和增量修正，不再从零制定方案。
6. workflow 启动前经过 lint / compile 阶段，减少不可控行为。
7. 页面能够展示 `OpenSpec` 的整体进度、阶段状态与修订历史。

### 3.6 工作流结算

工作流结束后出现“战后结算”区域。

结算内容包括：

1. Supervisor 对每个 Agent 的评分
2. 本次工作流总评
3. 最佳 Agent / 风险点 / 协作短板
4. Supervisor 总结的经验条目
5. 经验自动写入共享经验库
6. 评分结果反向影响后续编队与创建推荐

---

## 四、核心原则

### 4.1 Agent 是角色，不只是执行器

Agent 需要同时具备两类属性：

1. 角色属性
   - 谁
   - 什么风格
   - 擅长什么
   - 在 UI 上如何被感知

2. 执行属性
   - 用哪个 engine / model
   - 有哪些工具权限
   - systemPrompt 是什么
   - 能否参与工作流

### 4.2 Supervisor 是一等公民

Supervisor 不再只是“路由逻辑”或某些 Agent 的 prompt 片段，而是：

1. 有独立配置
2. 有独立头像和角色卡
3. 有独立 session
4. 可聊天
5. 可参与工作流各阶段判断
6. 可输出评分和经验沉淀

### 4.3 OpenSpec 是平台规划载体，不是某个 engine 的特性

平台统一暴露 OpenSpec 语义：

1. 需求澄清
2. 规范制品生成
3. 人工确认与修订
4. workflow 草案派生
5. 运行态进度同步与 Supervisor 修订

不同 engine 只负责执行已确认的 OpenSpec 上下文，不再各自维护独立规划模式。

### 4.4 经验需要结构化，而不是纯文本日志

经验沉淀最终目的是跨 workflow 复用，因此必须保留结构化字段，支持后续检索和注入。

### 4.5 角色层与编排层分离

系统需要明确区分：

1. 角色层
   - Agent 是谁
   - 有什么头像、人设、风格、长期能力

2. 编排层
   - 当前 workflow 如何组织这些 Agent
   - 谁先手、谁复核、谁收尾
   - 检查点在哪里
   - 该采用什么状态机结构

### 4.6 记忆必须分层

为了支持 workflow 结束后继续聊天，必须区分：

1. 角色长期记忆
2. 项目级共享知识
3. workflow 运行时记忆
4. 单次聊天上下文

否则上下文会逐渐污染，系统越来越不可控。

### 4.7 系统需要自增强闭环

本次改造不只做 UI 和交互，而应形成闭环：

1. workflow 运行
2. supervisor 评分
3. 经验沉淀
4. 经验检索
5. 编排推荐
6. 下一次 workflow 创建与启动直接受益

### 4.8 基础能力优先于首页交互

实现顺序必须调整为：

1. 先完成 Agent / Supervisor 领域模型
2. 再完成 workflow 运行绑定、session 持久化、run 关联
3. 再完成 plan 平台化与全局注入
4. 再清理 prompt / skill / action 中过时能力
5. 最后回到首页与 workflow 页做交互层收口

否则首页只能展示无法落地的伪能力。

### 4.9 Agent 不再默认拥有 GitCode 平台能力

本轮改造需要明确收口：

1. 首页与 API 层不再给 agent 提供 GitCode 相关平台能力。
2. workflow prompt、agent prompt、全局系统注入中都应删除 GitCode 专用引导。
3. 例外只有仓颉 SDK 拉取 nightly / release 的逻辑保留，因为它属于平台依赖而非 agent 能力。
4. `power-gitcode` 不再作为默认 agent skill 注入。

### 4.10 UI 组件约束

本轮所有前端改造必须遵守统一 UI 约束：

1. 优先使用仓库中已有的 shadcn 组件与现有封装组件。
2. 不新增原生裸 `button`、`input`、`select`、`dialog`、`textarea` 作为主要交互控件，除非仅作语义容器且已有样式体系无法覆盖。
3. 侧栏、弹框、抽屉、popover、tabs、badge、form、resizable 等能力优先复用 `src/components/ui/*` 与现有业务组件。
4. 新 UI 必须先检查是否已有可复用组件，再决定是否扩展。
5. 若历史代码中已有原生控件，本轮改造涉及该区域时应顺手迁移到现有组件体系，避免继续扩散。

---

## 五、Agent 创建机制设计

### 5.1 目标

Agent 创建器不再以独立 Skill 存在，而是作为平台内建创建机制。

其作用不是单纯生成一份 YAML，而是承担 Agent 设计助手的角色。

### 5.2 机制职责

平台内建的 Agent 创建机制应负责：

1. 收集 Agent 目标与角色风格
2. 生成角色设定草案
3. 生成执行配置草案
4. 生成头像配置建议
5. 生成 tools / model / team / roleType 建议
6. 运行 Agent 配置校验

### 5.3 实现归属

这些能力应归属于正式后端与前端模块，例如：

```text
src/lib/creator-validation.ts
src/app/api/agents/ai-draft/route.ts
src/app/api/agents/[name]/route.ts
src/components/AIAgentCreatorModal.tsx
```

### 5.4 与 workflow 创建机制的关系

1. workflow 创建机制
   - 负责 workflow 创建

2. Agent 创建机制
   - 负责 Agent 创建

3. 两者共享：
   - lint / compile 校验思路
   - 经验库
   - 角色层与编排层模型

---

## 六、Agent 领域模型设计

### 6.1 Agent 数据结构扩展

建议在现有 `RoleConfig` 的基础上扩展为两层模型：

1. 角色展示模型
2. 执行配置模型

建议新增字段：

```ts
type AgentRoleType = 'normal' | 'supervisor';
type AgentTeam = 'red' | 'blue' | 'yellow' | 'black-gold';
type AgentAvatarMode = 'deterministic' | 'generated' | 'uploaded' | 'preset';

interface AgentPersonaConfig {
  displayName: string;
  title?: string;
  description?: string;
  persona?: string;
  greeting?: string;
  styleTags?: string[];
  specialties?: string[];
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
  archetype?: string;
  team?: AgentTeam;
}

interface AgentAvatarConfig {
  mode: AgentAvatarMode;
  seed?: string;
  style?: string;
  prompt?: string;
  imageUrl?: string;
  thumbUrl?: string;
  presetName?: string;
}

interface AgentRuntimeConfig {
  name: string;
  roleType?: AgentRoleType;
  model: string;
  engine?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  keywords?: string[];
  alwaysAvailableForChat?: boolean;
  planCapabilities?: {
    canAskQuestions?: boolean;
    canDraftPlan?: boolean;
    canReviewPlan?: boolean;
  };
  workflowGuidanceCapabilities?: {
    canReviewStage?: boolean;
    canSuggestIteration?: boolean;
    canScoreAgents?: boolean;
    canWriteExperience?: boolean;
  };
}
```

### 6.2 Supervisor 配置模型

状态机工作流应支持配置：

```yaml
workflow:
  mode: state-machine
  supervisor:
    enabled: true
    agent: default-supervisor
    stageReviewEnabled: true
    checkpointAdviceEnabled: true
    scoringEnabled: true
    experienceEnabled: true
```

若未配置 `workflow.supervisor.agent`，则回退到默认的 `default-supervisor.yaml`。

同时需要新增运行态绑定模型：

```ts
interface WorkflowRunBinding {
  chatSessionId: string;
  configFile: string;
  runId: string;
  supervisorAgent: string;
  supervisorSessionId?: string;
  attachedAgentSessions: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
```

用途：

1. 首页聊天自动关联最近一次 workflow 运行
2. workflow 启动后自动绑定 supervisor 会话
3. workflow 结束后仍能继续和本次运行中的 supervisor / agents 对话

### 6.3 默认 Supervisor

新增默认 Agent：

1. 名称：`default-supervisor`
2. `roleType: supervisor`
3. 阵营：`black-gold`
4. 人设：指挥官 / 协调者 / 评审官
5. 始终可聊天
6. 默认启用工作流指导、评分、经验沉淀能力

### 6.4 基础实现优先级

第一阶段必须先完成：

1. `roleType: supervisor` 的 Agent 模型与默认 `default-supervisor`
2. workflow 配置中的 `workflow.supervisor`
3. 运行态 `runId -> supervisorSessionId -> attachedAgentSessions` 持久化
4. 工作流启动时自动创建 / 绑定 supervisor
5. 首页根据当前 chat session 自动解析并展示关联运行

未完成上述能力前，不继续扩展首页花哨交互。

---

## 七、头像系统设计

### 7.1 目标

头像系统需要满足以下需求：

1. 用户新建 Agent 时自动获得一张不同的头像
2. 不依赖人工上传，也能立即展示
3. 支持 AI 生成更具角色感的正式头像
4. 支持用户手动替换
5. Supervisor 使用专属黑金头像风格
6. 阵营视觉收口为四个阵营：蓝队、红队、黄队、黑金指挥官
7. 裁判不再作为单独阵营色处理，而作为“裁定席”职责风格存在

### 7.2 三层头像策略

建议采用三层策略：

#### 第一层：确定性默认头像

使用基于 seed 的 deterministic 本地 SVG 角色头像作为兜底。

不再采用“抽象几何头像”或“用户头像系统复用”的方案，而是采用可组合角色立绘思路：

1. 同一个 `agentId` / `agentName` 生成固定头像
2. 通过 seed 组合以下部件：
   - 脸型
   - 发型
   - 眼睛
   - 肩甲 / 领口
   - 饰件
   - 阵营纹章 / 光效背景
3. 不依赖外部头像服务，保证离线可用和前端可控
4. 默认就应具备“角色感”，而不是只满足“有个头像”

用途：

1. 创建 Agent 后立即有图
2. 无需等待 AI 图片生成
3. 适合作为失败回退图
4. 让角色卡从第一时间就有“选英雄/式神录”质感

#### 第二层：AI 正式头像

AI 创建 Agent 时，生成角色设定后，可异步生成正式头像。

用途：

1. 提供更强的角色辨识度
2. 支持和 persona 一致的视觉风格
3. 用于主卡片和详情页

#### 第三层：手动上传

用户可上传自定义头像覆盖系统头像。

### 7.3 字段设计

建议 agent 配置中新增：

```ts
interface AgentAvatarConfig {
  mode: 'deterministic' | 'generated' | 'uploaded' | 'preset';
  seed?: string;
  style?: string;
  prompt?: string;
  imageUrl?: string;
  thumbUrl?: string;
  presetName?: string;
  generatedAt?: string;
}
```

### 7.4 生成流程

建议流程如下：

1. 用户点击“AI 创建 Agent”
2. AI 先生成角色设定
3. 系统立即分配 deterministic avatar
4. 后台异步发起正式头像生成
5. 生成成功则替换 `imageUrl`
6. 生成失败则保留 deterministic avatar

### 7.5 四阵营与裁定席视觉约束

角色头像和卡面应遵循统一视觉规则：

1. 蓝队
   - 冷色、理性、防守、技术执行
   - 更偏护甲、稳定、秩序感

2. 红队
   - 高对比、锋利、攻击、挑战
   - 更偏锐角、压迫感、试探性

3. 黄队
   - 金黄、工程化、支援、构建
   - 更偏工具感、工匠感、装配感

4. 黑金指挥官
   - 黑金、高位、统御、决策
   - 更偏徽章、冠饰、权杖、仪式感

5. 裁定席
   - 不是第五阵营，而是职责席位
   - 视觉使用深石板 / 银白 / 淡金
   - 禁止使用偏紫魅惑系风格，避免看起来像法师阵营

### 7.6 存储建议

建议新增目录：

1. `data/agent-avatars/`
2. `data/agent-avatars/thumbs/`

若后续支持对象存储，可将 `imageUrl` 指向 S3 或外部存储。

### 7.7 前端展示建议

头像不应单独存在，而应配合角色卡视觉：

1. 大尺寸头像区
2. 阵营色背景与顶部能量条
3. 光效或轻量微动画
4. 标题、职责、能力标签
5. Supervisor 专属黑金卡面
6. 编辑动作悬浮在卡面角落，而不是打断卡片主体构图

---

## 八、Agent 管理页改造

### 8.1 页面定位

当前页面定位是“配置管理”。

改造后页面定位应为：

1. 角色大厅
2. 角色编成中心
3. 创建/维护 Agent 的主入口
4. 一眼看上去更像“角色名册”而不是“后台配置平台”

### 8.2 页面结构

建议页面分为四区：

1. 顶部角色大厅 Hero 区
   - 视觉化标题
   - 编队统计
   - 快速分组入口
   - 新建 Agent / 批量操作入口

2. 筛选控制区
   - 搜索
   - 阵营筛选
   - 分类筛选
   - 标签筛选

3. 主卡片名册区
   - 分阵营的大尺寸角色卡画廊
   - 卡片按 flex wrap 自然铺开
   - 编辑动作浮于卡面角落
   - 每个阵营有独立描述文案

4. 详情弹框 / 抽屉
   - 角色信息
   - 执行能力
   - Prompt 预览
   - 工具权限
   - 聊天测试

### 8.3 AI 引导创建 Agent

建议新增 AI 向导流程：

1. 收集需求
   - 你想让这个 Agent 做什么
   - 偏技术还是偏管理
   - 风格偏理性/活泼/严谨/强势
   - 是否可写代码
   - 是否可担任 supervisor

2. AI 生成草案
   - 名称
   - displayName
   - persona
   - description
   - keywords
   - systemPrompt
   - avatar prompt
   - model / tools 建议

3. 用户确认
   - 调整角色设定
   - 调整工具权限
   - 保存

建议默认由平台内建 Agent 创建机制驱动，避免后续继续依赖散落在 prompt 和 skill 里的临时规则。

### 8.4 后端接口建议

新增 API：

1. `POST /api/agents/ai-draft`
   - 输入角色需求
   - 输出 agent 草案

2. `POST /api/agents/generate-avatar`
   - 为指定 agent 生成头像

3. `POST /api/agents/:name/chat`
   - 与指定 agent 发起聊天

### 8.5 首页侧边栏集成方式

Agent 创建不应只存在于独立页面，也应集成到首页右侧边栏。

建议在首页右侧边栏中提供“创建 Agent”入口，并复用与独立 Agent 创建页一致的引导式体验：

1. 分步骤提问
2. 角色卡预览
3. 头像预览
4. 配置草案预览
5. 一键保存或继续编辑

---

## 九、Workflow 页面 Agent 对话系统

### 9.1 目标

工作流页左下角 Agent 标签页不再只是状态展示，而是支持直接沟通。

### 9.2 对话类型

建议区分两种聊天模式：

1. `standalone-chat`
   - 普通角色聊天
   - 不自动附带 workflow 上下文

2. `workflow-chat`
   - 附带当前 workflow 上下文
   - 适用于正在运行中的工作流

### 9.3 对话对象

应支持：

1. 当前正在执行的 agent
2. 当前 workflow 中存在但此刻空闲的 agent
3. workflow 外但 `alwaysAvailableForChat=true` 的 agent
4. supervisor

### 9.4 会话模型建议

建议引入两类 session：

```ts
interface AgentChatSession {
  id: string;
  agentName: string;
  mode: 'standalone-chat' | 'workflow-chat';
  runId?: string;
  workflowConfig?: string;
  backendSessionId?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
```

### 9.5 UI 交互建议

左下角 Agent 标签页建议展示：

1. Agent 头像
2. 名称
3. 当前状态
4. 是否可聊天
5. 最近一条摘要
6. 未读标识

点击后打开侧边聊天面板或底部抽屉。

### 9.6 Workflow 结束后的行为

Workflow 结束后：

1. 相关 Agent 的聊天入口仍保留
2. 可切换为“查看历史上下文后继续问”
3. Supervisor 聊天入口保留

---

## 十、全局 Supervisor 机制

### 10.1 当前问题

当前 Supervisor 主要是：

1. 路由逻辑
2. plan 协议驱动
3. 某些 agent prompt 中注入“如果需要问问题就输出特殊标记”

问题在于：

1. 不是一等公民
2. 无法独立聊天
3. 无法形成长期角色身份
4. plan 逻辑分散在 agent prompt 中

### 10.2 新模型

Supervisor 升级为三层能力：

1. 路由层
   - 接受信息请求
   - 决定问谁

2. 指挥层
   - 审阅阶段结果
   - 给出下一轮指导建议
   - 在 checkpoint 给出意见
   - 定时汇报当前进度

3. 评审层
   - 工作流结束后评分
   - 提炼经验

### 10.3 状态机默认启用

状态机 workflow 默认行为：

1. 自动挂载 Supervisor Agent
2. 默认开启 stage review
3. 默认开启 checkpoint advice
4. 默认开启结算评分
5. 默认开启经验沉淀

### 10.4 系统提示词注入改造

后续应将当前分散在 Agent YAML 中的 Supervisor/Plan prompt 收拢到统一注入层。

建议拆成：

1. `baseSystemPrompt`
2. `stateMachineExecutionPrompt`
3. `supervisorRoutingPrompt`
4. `supervisorStageReviewPrompt`
5. `supervisorCheckpointPrompt`
6. `supervisorScoringPrompt`
7. `supervisorExperiencePrompt`
8. `supervisorProgressReportPrompt`
9. `platformPlanPrompt`

OH 相关 agent 的 yaml 中不再写 plan/supervisor 相关协议提示。

---

## 十一、OpenSpec / Plan 机制平台化

### 11.1 目标

Plan 机制应以前移的 `OpenSpec` 形式成为状态机工作流的配置项，而不是少数 agent 的 prompt 能力。

核心原则：

1. 主计划在“创建 workflow”阶段产生
2. 主计划以 `OpenSpec` 持久化
3. workflow 草案由 `OpenSpec` 派生
4. 运行时只允许对 `OpenSpec` 做增量修正，不再重新从零做一套 plan
5. 所有 Agent 都共享同一个 `OpenSpec` 视图

### 11.1.1 OpenSpec 数据结构建议

建议引入统一结构：

```ts
interface OpenSpecDocument {
  id: string;
  workflowName?: string;
  summary: string;
  goals: string[];
  nonGoals?: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  phases: OpenSpecPhase[];
  assignments: OpenSpecAssignment[];
  checkpoints: OpenSpecCheckpoint[];
  progress: OpenSpecProgress;
  revisions: OpenSpecRevision[];
  createdAt: string;
  updatedAt: string;
}

interface OpenSpecPhase {
  key: string;
  title: string;
  objective: string;
  ownerAgents: string[];
  inputs?: string[];
  outputs?: string[];
  status: 'pending' | 'running' | 'completed' | 'blocked';
}

interface OpenSpecAssignment {
  agent: string;
  responsibilities: string[];
  phases: string[];
}

interface OpenSpecCheckpoint {
  key: string;
  title: string;
  phaseKey?: string;
  trigger: string;
  status: 'pending' | 'reached' | 'resolved';
}

interface OpenSpecProgress {
  completedPhaseCount: number;
  totalPhaseCount: number;
  summary: string;
  risks?: string[];
}

interface OpenSpecRevision {
  id: string;
  reason: string;
  summary: string;
  updatedBy: 'supervisor' | 'user' | 'system';
  timestamp: string;
}
```

### 11.2 配置方式

建议新增工作流级配置：

```yaml
workflow:
  mode: state-machine
  plan:
    enabled: true
    carrier: openspec
    implementation: auto
    maxRounds: 5
    requireApproval: true
    allowRejectRegenerate: true
```

说明：

1. `enabled`
   - 是否启用平台 plan / openspec 机制

2. `carrier`
   - 默认固定为 `openspec`
   - 表示 plan 的主承载体

3. `implementation`
   - `auto`
   - `native`
   - `supervisor-lite`

4. `maxRounds`
   - 最大重试轮次

5. `requireApproval`
   - 是否需要人工审批

### 11.3 engine 适配策略

#### 原生 Plan 引擎

支持原生 plan 的 engine：

1. 使用原生 plan
2. 保留平台统一事件接口

#### 非原生 Plan 引擎

不支持原生 plan 的 engine：

1. 使用 Supervisor-Lite 维护 `OpenSpec`
2. 统一暴露提问、生成、审批、驳回重做能力

### 11.4 step override

工作流级 plan 为默认值，step 可覆盖：

```yaml
steps:
  - name: 需求分析
    plan:
      enabled: true
      requireApproval: true
  - name: 代码修复
    plan:
      enabled: false
```

### 11.5 生命周期

`OpenSpec` 的生命周期建议如下：

1. workflow 创建时生成初版
2. 用户确认后落盘
3. 启动 workflow 时注入给所有 Agent
4. 运行中由 Supervisor 维护进度与版本
5. 用户可通过与 Supervisor 对话触发“刷新 OpenSpec”
6. workflow 结束后将最终 `OpenSpec` 与结算结果一起归档

---

## 十二、阶段审阅与迭代指导

### 12.1 触发时机

建议在状态机中新增三个钩子：

1. `beforeState`
2. `afterState`
3. `beforeHumanCheckpoint`

### 12.2 afterState 审阅

每个 state 执行完后，自动调用 Supervisor 审阅。

输入：

1. 当前 state 名称
2. 本 state 的 step 输出
3. 当前 issues
4. 当前 verdict
5. 当前 state history
6. 当前工作目录摘要

输出建议结构：

```ts
interface SupervisorStageReview {
  action: 'continue' | 'iterate' | 'warn';
  summary: string;
  advice: string;
  risks: string[];
  nextFocus: string[];
}
```

### 12.3 迭代指导

如果 Supervisor 认为需要继续迭代：

1. 将建议注入下一轮上下文
2. 在 UI 中明确展示“指挥官建议”
3. 若 workflow 配置允许，可影响下一步执行上下文

### 12.4 定时进度汇报

建议增加进度汇报策略：

1. 每个大阶段完成后必汇报一次
2. 长时间运行的 workflow 定时汇报
3. 命中风险条件时立即汇报

建议汇报内容：

1. 当前阶段
2. 当前进度
3. 已完成事项
4. 风险
5. 下一步计划

---

## 十三、人工检查点增强

### 13.1 当前能力

当前人工检查点更偏“状态选择”。

### 13.2 改造目标

改造后的检查点弹窗应包含：

1. 当前状态总结
2. 可进入状态列表
3. Supervisor 建议
4. 征询 Supervisor 意见按钮
5. 与 Supervisor 对话区域
6. 用户最终选择

### 13.3 交互流程

建议流程：

1. 进入 checkpoint
2. 系统先生成 Supervisor 建议
3. 用户查看建议
4. 用户可继续提问
5. 用户最终决定跳转到哪个状态

---

## 十四、工作流结算与评分

### 14.1 目标

工作流完成后，Supervisor 给出明显的战后结算视图。

### 14.2 评分维度

建议每个 Agent 至少评以下维度：

1. 任务完成度
2. 输出质量
3. 协作质量
4. 稳定性
5. 响应效率

建议总分：

1. `0-100`
2. 映射 `S / A / B / C`

### 14.3 评分结果结构

```ts
interface AgentScoreCard {
  agentName: string;
  totalScore: number;
  grade: 'S' | 'A' | 'B' | 'C';
  dimensions: {
    taskCompletion: number;
    outputQuality: number;
    collaboration: number;
    stability: number;
    efficiency: number;
  };
  strengths: string[];
  weaknesses: string[];
  summary: string;
}

interface WorkflowFinalReview {
  runId: string;
  totalGrade: 'S' | 'A' | 'B' | 'C';
  overallSummary: string;
  bestAgent?: string;
  biggestRisk?: string;
  scoreCards: AgentScoreCard[];
}
```

### 14.4 展示位置

应在 workflow 完成后最显眼位置展示：

1. 总评 Banner
2. Agent 评分卡列表
3. 最佳 Agent
4. 风险项
5. Supervisor 总结

### 14.5 持久化

建议保存到：

1. `runs/{runId}/final-review.yaml`
2. `runs/{runId}/final-review.md`

### 14.6 评分反哺系统

评分结果不应只展示，还应反馈给系统：

1. Agent 卡片上的近期表现
2. workflow 创建时的推荐排序
3. 编队推荐置信度
4. 经验条目权重
5. supervisor 的后续提示重点

---

## 十五、经验共享库设计

### 15.1 目标

经验共享库用于让所有工作流共享已沉淀的方法论。

### 15.2 存储位置

建议新增全局目录：

1. `data/workflow-memory/entries/`
2. `data/workflow-memory/index.yaml`

也可考虑：

1. `data/experience-library/`

### 15.3 经验条目结构

建议每条经验同时保存 Markdown 和结构化 YAML/JSON。

```ts
interface WorkflowExperienceEntry {
  id: string;
  createdAt: string;
  sourceRunId: string;
  configFile: string;
  workflowType: string;
  tags: string[];
  problemPattern: string;
  successfulStrategy: string;
  failedStrategy?: string;
  applicableWhen: string[];
  avoidWhen?: string[];
  summary: string;
  exampleFiles?: string[];
}
```

### 15.4 经验库升级为策略库

经验库建议一开始就区分：

1. 模式经验
2. 失败经验
3. 编排经验

这样新 workflow 启动时可以直接推荐：

1. 初始状态机模板
2. 推荐 Agent 编组
3. 推荐检查点位置
4. 推荐迭代上限

### 15.5 生成时机

工作流结束后：

1. Supervisor 先生成总结
2. 再输出结构化经验条目
3. 系统写入全局经验库

### 15.6 注入时机

新的 workflow 启动时：

1. 按 workflow 类型筛选
2. 按 tags / configFile / requirement 检索
3. 将最相关经验注入 Supervisor
4. 必要时也注入关键 Agent

### 15.7 经验注入层级

建议分为：

1. 全局经验
2. 项目经验
3. workflow 类型经验
4. 最近类似运行经验

---

## 十六、Agent 关系系统与编队推荐

### 16.1 目标

Agent 角色化之后，系统不应只理解单个 Agent，还要理解 Agent 之间如何搭配。

### 16.2 关系类型

建议增加：

1. 协作偏好
2. 审核关系
3. 先手/后手关系
4. 互补关系
5. 冲突关系

### 16.3 关系数据结构

```ts
interface AgentRelationship {
  source: string;
  target: string;
  type: 'prefers' | 'reviews' | 'handoff' | 'complements' | 'conflicts';
  score: number;
  reason?: string;
  updatedAt: string;
}
```

### 16.4 用途

这些关系用于：

1. workflow 创建时推荐编队
2. supervisor 决定分工
3. 评分回推协作质量
4. 经验库沉淀编排经验

---

## 十七、Workflow lint / compile 检查器

### 17.1 目标

workflow 越来越依赖 AI 创建后，必须在运行前做静态检查。

### 17.2 检查内容

建议检查：

1. 是否缺少 supervisor
2. 是否存在不可达状态
3. 是否存在死循环风险
4. step 对应 agent 是否存在
5. plan 配置是否冲突
6. 检查点是否缺失
7. 是否命中历史失败经验

### 17.3 输出

建议输出结构化问题：

1. error
2. warning
3. suggestion

并在 UI 中作为 workflow 启动前的编排检查结果展示。

---

## 十八、记忆分层与上下文边界

### 18.1 记忆层级

建议拆为：

1. Persona Memory
2. Project Memory
3. Workflow Memory
4. Session Memory

### 18.2 使用边界

1. Persona Memory
   - 长期保留
   - 只保存风格和长期偏好

2. Project Memory
   - 项目级共享
   - 存放长期有效知识

3. Workflow Memory
   - 与 runId 绑定
   - workflow 结束后可只读复用

4. Session Memory
   - 聊天会话临时上下文
   - 随会话结束逐步失效

### 18.3 风险

如果不做边界控制，长期聊天与 workflow 上下文会相互污染，导致：

1. Agent 错误继承过时信息
2. workflow 复盘结果不可靠
3. Supervisor 建议基于错误上下文

---

## 十九、首页聊天页内建指挥官边栏

### 19.1 设计取向

不建议单独新增一个重型“驾驶舱页面”，而应把指挥官能力内建进首页聊天页。

理由：

1. 创建 workflow、绑定指挥官、启动 workflow 是连续动作
2. 纯对话加卡片展示不可控，容易状态分裂
3. 右侧边栏更适合作为稳定的状态与控制面板

### 19.2 核心能力

右侧边栏应内建支持：

1. 创建 workflow
2. 查看与编辑当前 `OpenSpec`
3. 绑定 supervisor
4. 启动 workflow
5. 查看当前绑定 workflow
6. 查看指挥官汇报
7. 和指挥官直接对话
8. 查看风险与建议

补充要求：

1. 这些能力不是固定陈列，而应由对话语义动态触发
2. 同一个侧栏容器根据消息内容切换不同工作态
3. 侧栏的当前绑定对象必须跟随当前 chat session 变化，而不是全局固定单例

### 19.3 建议模块

建议右侧边栏分块：

1. 指挥官头部卡
2. 当前 workflow 卡
3. 进度摘要
4. 最新汇报
5. 风险提示
6. 操作按钮区

但模块展示顺序不应写死，而应按当前语义动态重排：

1. 当用户在创建 workflow 时，创建面板优先
2. 当用户在追问当前进度时，指挥官汇报与风险提示优先
3. 当用户在查看历史结果时，workflow 摘要与结算信息优先
4. 当用户在普通聊天时，只保留最小摘要，不强占主界面

### 19.4 右侧边栏中的引导式创建模式

右侧边栏不只是状态展示，还应承载结构化创建能力。

建议边栏支持切换以下面板：

1. `指挥官`
   - 当前 workflow 状态
   - 当前 `OpenSpec` 摘要
   - 指挥官对话
   - 最新汇报

2. `创建工作流`
   - 复用当前独立“AI 引导创建工作流”的交互模式
   - 分步骤引导
   - `OpenSpec` 生成与确认
   - 配置预览
   - lint 结果

3. `创建Agent`
   - 复用平台内建 Agent 创建机制
   - 角色设定引导
   - 头像预览
   - Agent 配置草案

4. `启动与绑定`
   - 绑定 supervisor
   - 绑定 `OpenSpec`
   - 选择 workflow
   - 启动 workflow

这样首页右侧边栏就不是“聊天附属区域”，而是与聊天联动的结构化控制区。

### 19.5 动态触发与自动绑定机制

首页右侧边栏应增加一层“会话意图编排器”，负责从聊天流中推断当前应该展示什么，而不是由用户手动切 tab。

建议该层输出统一结构：

```ts
interface HomeSidebarIntent {
  intent:
    | 'create-workflow'
    | 'run-workflow'
    | 'ask-supervisor'
    | 'create-agent'
    | 'inspect-result'
    | 'plain-chat';
  confidence: number;
  targetWorkflow?: string;
  targetRunId?: string;
  targetSupervisor?: string;
  targetAgent?: string;
  preferredPanel?: 'commander' | 'workflow' | 'agent';
  displayMode?: 'hidden' | 'peek' | 'active';
}
```

建议处理流程：

1. 用户发送消息
2. 系统先基于消息内容、当前 session 绑定、最近动作记录推断 `HomeSidebarIntent`
3. 若命中高置信度工作流语义，则自动展开侧栏并切到目标面板
4. 若只命中弱语义，则保持 peek 态，只展示一条可进入的摘要卡
5. 若用户显式关闭侧栏，则本轮语义结束前不反复强行弹出
6. 一旦 workflow run / supervisor / agent 发生变化，立即刷新绑定并回写到 session

这样可以保证：

1. 首页侧栏是“跟着对话走”的
2. workflow 绑定是动态上下文，不是静态配置
3. 用户不需要维护复杂的“当前到底绑定了谁”的心智
4. 首页体验不会退化成固定 tab + 固定卡片的后台页面
5. `OpenSpec` 可以作为首页侧栏里的稳定状态源，而不是只靠零散卡片拼接

---

## 二十、演练模式

### 20.1 目标

新增不直接改真实项目的演练模式。

### 20.2 行为

演练模式下：

1. Agent 只做设计、推演、评审
2. 不执行破坏性改动
3. 输出建议编排
4. 输出风险分析
5. 输出推荐的正式 workflow 配置

### 20.3 用途

1. workflow 设计演练
2. Agent 配置调优
3. 提前发现状态机设计问题

---

## 二十一、数据持久化与恢复

### 21.1 必须新增的持久化对象

为支持角色聊天、Supervisor、经验库，需要新增持久化：

1. Agent chat sessions
2. Workflow-attached agent chat sessions
3. Supervisor session
4. `OpenSpec` document
5. `OpenSpec` revision history
6. Pending checkpoint advice
7. Pending final review
8. Workflow experience entries
9. 指挥官定时汇报记录
10. 首页右侧边栏的 workflow 绑定状态

### 21.2 建议新增目录

```text
data/
  agent-avatars/
  agent-chat-sessions/
  openspec/
    documents/
    revisions/
  workflow-memory/
    entries/
    index.yaml
  supervisors/
    sessions/
    reports/
```

### 21.3 状态机恢复要求

状态机 `resume()` 时需要恢复：

1. agent sessionId
2. supervisor sessionId
3. `OpenSpec` 当前版本
4. pending plan review
5. pending checkpoint advice
6. pending workflow chat context
7. 最近一次 supervisor 汇报

---

## 二十二、主要代码改造点

### 22.1 Schema / Config

建议修改：

1. `src/lib/schemas.ts`
2. Agent yaml 解析逻辑
3. Workflow yaml 解析逻辑
4. 默认 Supervisor yaml
5. `OpenSpec` schema 与序列化逻辑
6. Skill 默认启用逻辑

### 22.2 Runtime / Manager

建议修改：

1. `src/lib/state-machine-workflow-manager.ts`
2. `src/lib/workflow-manager.ts`
3. `src/lib/supervisor-router.ts`
4. 新增 `src/lib/openspec-store.ts`
5. 新增 `src/lib/supervisor-service.ts`
6. 新增 `src/lib/agent-chat-store.ts`
7. 新增 `src/lib/workflow-experience-store.ts`
8. 新增 `src/lib/agent-avatar-store.ts`
9. 新增 `src/lib/workflow-linter.ts`
10. 新增 `src/lib/agent-relationship-store.ts`
11. 新增 `src/lib/memory-layer-manager.ts`

### 22.3 API

建议新增或扩展：

1. `src/app/api/agents/...`
2. `src/app/api/workflow/...`
3. 新增 `src/app/api/openspec/...`
4. 新增 `src/app/api/agent-chat/...`
5. 新增 `src/app/api/workflow/final-review/...`
6. 新增 `src/app/api/workflow/experience/...`
7. 新增 `src/app/api/agents/generate-avatar/...`
8. 新增 `src/app/api/agents/ai-draft/...`
9. 新增 `src/app/api/workflow/lint/...`
10. 新增 `src/app/api/supervisor/sidebar/...`

### 22.4 Frontend

建议重点改造：

1. [agents page](/Users/sundaiyue/Documents/ACEHarness/src/app/agents/page.tsx)
2. [workbench page](/Users/sundaiyue/Documents/ACEHarness/src/app/workbench/[config]/page.tsx)
3. [chat page](/Users/sundaiyue/Documents/ACEHarness/src/app/page.tsx)
4. 新增 `OpenSpec` 创建与确认面板
5. 新增 `OpenSpec` 进度组件
6. 新增 Agent 角色卡组件
7. 新增 Agent 对话面板
8. 新增 Workflow 结算评分组件
9. 新增 Supervisor 建议弹窗
10. 新增首页右侧指挥官边栏
11. 新增 workflow lint 结果面板

---

## 二十三、实施顺序

### 阶段 1：模型、Skill 与默认配置

目标：

1. 扩展 Agent 模型
2. 增加默认 Supervisor yaml
3. 增加 workflow 级 `openspec` / plan / supervisor 配置
4. 增加内建 Agent 创建与校验机制

交付：

1. schema 更新
2. 默认配置可加载
3. 旧配置可兼容
4. Agent 创建机制可输出合法草案

### 阶段 2：创建期 OpenSpec 与 Supervisor 前移

目标：

1. Supervisor 从 workflow 创建阶段就参与
2. 收集需求后生成 `OpenSpec`
3. 基于 `OpenSpec` 生成 workflow 草案与 Agent 分工

交付：

1. workflow 创建流程可产出 `OpenSpec`
2. `OpenSpec` 可持久化与确认
3. Agent 分工从 `OpenSpec` 自动派生

### 阶段 3：Supervisor 运行时一等公民化

目标：

1. 状态机默认挂载 Supervisor
2. 支持 stage review / checkpoint advice
3. 运行时基于 `OpenSpec` 做进度跟踪与增量修正

交付：

1. Supervisor 可参与工作流
2. 所有状态机默认有 Supervisor
3. 运行时 `OpenSpec` 状态可更新

### 阶段 4：Agent 对话系统与首页右侧边栏

目标：

1. Workflow 页面中的 Agent 聊天
2. Supervisor 聊天
3. Workflow 结束后保留聊天入口
4. 首页右侧指挥官边栏
5. `OpenSpec` 进度展示
6. 指挥官定时汇报

交付：

1. Agent 通讯录
2. Agent chat session 持久化
3. 首页内建 workflow 绑定 / 启动 / 汇报能力
4. `OpenSpec` 进度 UI

### 阶段 5：Agent 管理页角色化与头像系统

目标：

1. 角色卡页面
2. 头像系统
3. AI 创建 Agent

交付：

1. 角色大厅
2. deterministic avatar
3. AI 头像生成链路

### 阶段 6：结算评分、经验库与编排推荐

目标：

1. Supervisor 工作流结算
2. 全局经验沉淀
3. 新 workflow 经验注入
4. Agent 关系与编队推荐
5. 评分反哺系统

交付：

1. 战后结算 UI
2. 结构化经验库
3. 编队推荐数据

### 阶段 7：lint / compile、记忆分层与演练模式

目标：

1. workflow lint / compile
2. 记忆分层
3. 演练模式

交付：

1. workflow 启动前检查
2. 记忆边界可控
3. 不改真实项目的演练能力

---

## 二十四、兼容迁移策略

### 24.1 Agent 配置迁移

对旧 agent：

1. 自动补 `displayName`
2. 自动补 `avatar.mode=deterministic`
3. 自动补 `team`
4. 自动补 `roleType=normal`

### 24.2 Supervisor Prompt 迁移

对旧 OH agent：

1. 清理 plan / supervisor 相关提示词
2. 收拢到平台注入层

### 24.3 Workflow 配置迁移

对旧状态机 workflow：

1. 默认注入 `workflow.supervisor.enabled=true`
2. 移除旧 `workflow.plan` 与 step 级信息收集循环字段
3. 创建态 OpenSpec 制品作为唯一规划载体，运行态只消费确认后的 spec snapshot

### 24.4 数据兼容

旧的 run / chat 数据保持可读。

新增字段全部允许缺省。

---

## 二十五、风险与注意事项

### 25.1 最大风险

1. Supervisor 一旦变成真实 Agent，session 管理会显著复杂化。
2. “工作流结束后仍可聊天”意味着执行 session 与聊天 session 不能混为一谈。
3. Plan 如果要求所有 engine 支持，就必须抽象成平台能力，不能继续绑定单一引擎实现。
4. 首页右侧边栏如果没有稳定状态源，会再次退化成“纯卡片展示”。

### 25.2 技术注意项

1. 头像生成必须异步，不能阻塞 Agent 创建主流程。
2. 经验库必须有结构化索引，否则后续难以检索注入。
3. Workflow resume 必须恢复 agent/supervisor session，否则建议与聊天上下文会断裂。
4. 评分结果不能只写富文本，必须有结构化数据供 UI 渲染。
5. 定时汇报必须基于稳定事件源或调度器，不应只依赖前端轮询。

---

## 二十六、建议的 MVP

为了降低一次性改造风险，建议先做 MVP：

1. 默认 Supervisor Agent
2. workflow 创建阶段生成 `OpenSpec`
3. 状态机默认启用 Supervisor stage review
4. Workflow 页面左下 Agent 列表可聊天
5. 首页右侧指挥官边栏
6. `OpenSpec` 进度展示
7. Agent 管理页改成角色卡
8. deterministic avatar
9. AI 引导创建 Agent
10. 内建 Agent 创建机制
11. 工作流结束后 Supervisor 给 Agent 打分
12. 经验写入全局经验库

MVP 完成后再迭代：

---

## 二十七、当前剩余待办记录

截至当前这轮改造，以下事项仍需继续推进：

### 27.1 OpenSpec 主链

1. 将 workflow 创建流程改成“需求收集 → 设计 → OpenSpec → workflow 草案”
2. 新增 `OpenSpecDocument` / `Phase` / `Assignment` / `Checkpoint` / `Progress` / `Revision` 数据结构
3. 增加 `OpenSpec` 持久化与版本管理
4. workflow 启动时将 `OpenSpec` 注入给所有 Agent
5. Supervisor 在运行时维护 `OpenSpec`，而不是重新从零做 plan
6. 支持通过与 Supervisor 对话触发“刷新 OpenSpec”

### 27.2 创建页与首页侧栏

1. 首页右侧指挥区继续收口
   - 将更多“卡片式结果展示”改为触发右侧侧栏 / sheet / modal
   - 进一步减少“发到聊天”型按钮，改成直接进入结构化引导流程
   - 校验所有 AI 返回的 card/action 按钮链路，删除无效按钮，修复可保留按钮

2. 首页自动关联机制继续完善
   - 根据当前会话自动关联最近一次 workflow run
   - workflow 创建、agent 创建、workflow 启动后的 supervisor/run/openspec 关联继续补强
   - 减少任何显式“手动绑定”心智
   - 增加基于对话语义的侧栏动态唤起、动态面板切换与动态绑定

3. 创建 workflow 时显式展示 `OpenSpec` 生成、确认、修订步骤
4. 首页侧栏增加 `OpenSpec` 摘要、阶段进度、修订历史入口

### 27.3 Workflow 运行页

1. Workflow 页面增加 `OpenSpec` 进度区
   - 显示阶段总进度
   - 显示每阶段负责 Agent
   - 显示 checkpoint 状态
   - 显示最近一次 `OpenSpec` 修订

2. Workflow 页面 Agent 通讯录
   - 支持运行中与运行后唤醒 agent session 继续聊天
   - supervisor 作为一等聊天对象持续可用
   - 区分普通聊天与带 workflow 上下文的聊天

3. 侧栏交互继续完善
   - 右侧侧栏继续补全展开 / 收起 / 拖拽细节
   - 补更多详情抽屉，承接 workflow/agent/openspec 详情，而非继续堆卡片

### 27.4 Agent 与创建体验

1. Agent AI 创建链路继续完善
   - 首页右侧的 Agent 创建入口与 Agent 页面保持统一体验
   - 异步正式头像生成链路目前仍是 deterministic 预览优先，后续可补正式图生成与替换

2. AI 正式头像生成

### 27.5 运行时能力

1. 更复杂的 checkpoint 对话
   - checkpoint 中直接查看当前 `OpenSpec`
   - checkpoint 中可请求 Supervisor 刷新 `OpenSpec`

2. 更强的经验检索与召回
   - 将历史经验注入 `OpenSpec` 生成阶段
   - 将历史经验注入 Supervisor 运行时修订阶段

3. 更细的关系系统与演练模式
   - Agent 关系用于创建期分工推荐
   - 演练模式用于先生成 `OpenSpec` 和 workflow 草案而不执行真实变更

### 27.6 明确未完成项清单

1. `OpenSpec` 数据模型、持久化、API 尚未落地
2. 创建 workflow 阶段的 `OpenSpec` 生成与确认 UI 尚未落地
3. workflow 运行页的 `OpenSpec` 进度 UI 尚未落地
4. 通过 Supervisor 对话刷新 `OpenSpec` 的机制尚未落地
5. Agent 持续聊天与 workflow-chat / standalone-chat 分层尚未完全收口
6. workflow lint / compile 尚未形成完整启动前检查链路
7. 记忆分层、关系系统、演练模式仍处于待实现状态

---

## 二十七、后续建议拆分文档

本设计文档是总纲。后续建议继续拆成专题文档：

1. `Agent头像系统设计.md`
2. `全局Supervisor运行时设计.md`
3. `Workflow Agent 对话系统设计.md`
4. `工作流结算与经验库设计.md`
5. `Plan 平台化改造设计.md`
6. `首页右侧指挥官边栏设计.md`
7. `Workflow lint 与演练模式设计.md`
8. `记忆分层与Agent关系系统设计.md`
