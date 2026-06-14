# 一人公司模式、Agent 深层记忆与协作空间实现计划

状态：部分实施，仍缺 AI 澄清式组队草案、完整组织版本管理、真实办公室行为和 direct room 闭环。

当前实现状态（2026-06-15）：

- 已完成一部分基础设施：Agent YAML 支持 `workspaceProfile`，Agent 编辑页已有协作空间配置和基础 role memory 编辑入口，办公室成员可从 Agent YAML 派生。
- 已完成一部分办公室入口：`/office` 页面已有一句话输入、团队候选预览、按实际成员动态渲染的组织架构图、办公室工位展示、成员选中面板、屏幕 SVG 覆盖层和基础交互。
- 已完成一部分团队生成后端：`/api/office/team/plan` 和 `/api/office/team/apply` 可从 Agent YAML 生成候选并写回 `workspaceProfile`；当前已把办公室预览扩展到最多 12 名现有 Agent。
- 当前 `/office` 组织架构图已去掉固定 6 席位和“专家池 / 空缺岗位”UI，改为根据现有团队成员动态布局；管理操作已支持用 shadcn `Select` 添加、替换成员，以及删除成员并生成“确认前不写入”的组织草案。仍缺拖拽汇报关系、职责编辑、版本 diff、历史恢复和 AI 澄清式组织草案。
- 当前办公室行为已做第三版修正：成员默认在工位坐姿办公/思考，已接入 `sit_left/right` 四帧素材；交流行为改为一组 agent 互相参与，访客从自己工位沿前方走道移动到同事工位侧边，并在到达阶段隐藏回弹以避免倒着走；工位隔间已拆成后墙和前墙层，屏幕和 SVG 覆盖层已镜像并跟随桌面透视，椅背/椅座会夹住坐姿人物下半身；工位网格已压缩单站尺度并扩大行列间距，键盘、鼠标和显示器的位置已按桌面相对关系重排。仍缺 talk 专用素材、per-agent 动作资源、稳定高质量 walk cycle 和基于真实协作事件的行为调度；工位墙体贴地、人物脚底锚点和桌面物件透视仍需要逐张截图迭代。
- 仍未完成核心产品闭环：团队生成目前主要是本地关键词/zone 打分，不是像工作流创建器那样的 AI 澄清、草案、用户确认流程；组织架构管理仍是前端雏形；direct room 创建和拉人协作闭环还未在 `/office` 中真正打通。
- 粗略完成度：基础配置与成员派生约 60%，办公室视觉与交互约 45%，组织架构管理约 40%，AI 组队与确认流程约 20%，记忆运行时统一注入约 35%，整体约 45%-50%。

## 1. 背景与目标

当前 ACEHarness 更偏向“开发工程师工作台”：用户进入后主要围绕工作流、Agent、Workspace、模型与运行历史开展工作。现有协作会话和常驻角色已经具备多人协作雏形，下一步可以统一升级为“协作空间”：工程师模式下展示为会议室，一人公司模式下展示为办公室。用户用一句话描述目标，系统帮助组织 CEO/协调者、产品、设计、工程、增长、运营、通才等角色，形成可持续协作的虚拟团队。

本计划目标是引入两种用户心智：

- 工程师模式：保持当前默认体验，协作入口升级为会议室，不默认启用 Agent 记忆参与推理。
- 一人公司模式：默认进入办公室，启用 Agent 记忆参与推理，把常驻成员组织成用户的个人 AI 团队。

同时梳理并升级现有 Agent 级永久记忆：

- 现有 `src/lib/workflow/memory-store.ts` 已提供多层记忆，其中 `scope = role` 就是 Agent 级长期角色记忆。
- Agent memory 统一收敛到现有 `memory-store`，把已有能力升级成可配置、可查看、可检索、可接入办公室的正式产品能力。
- 记忆持续沉淀，不受运行时开关影响。
- 运行时是否注入 memory 由全局系统设置决定。
- Agent 级长期角色记忆需要增加可编辑 UI、全局开关、基础记忆预算、深层记忆数据库和办公室接入。

## 2. 设计原则与改造边界

- 记忆存储以现有 `memory-store` 为统一入口，围绕 `role` scope 完成 Agent 长期记忆的管理、展示、注入、检索和沉淀候选。
- 深层记忆采用“基础记忆 + 数据库”的组合：基础记忆进入常规上下文，深层记忆进入可按需查询的检索库。
- 协作空间沿用现有房间、参与者和消息机制，工程师模式展示为会议室，一人公司模式展示为办公室。
- 私聊作为协作空间房间的一种轻量形态实现，继续复用房间、参与者和消息机制。
- 工程师模式继续保持当前工作台体验，一人公司模式通过用户选择或系统设置启用。
- 老用户保持当前入口和使用习惯，新用户在首次引导中选择体验模式。
- 常驻成员由 Agent YAML 直接驱动；会议室和办公室从 Agent 配置派生成员展示、工位和私聊入口。

## 3. 核心概念

### 3.0 当前记忆机制评估

现有 Agent 记忆机制可以作为底座继续使用；面向“一人公司模式”需要补齐产品化管理、统一注入、深层检索和办公室接入能力。

已具备能力：

- `src/lib/workflow/memory-store.ts` 已提供 `role / project / workflow / chat` 四层记忆。
- `role` scope 已经等价于 Agent 级长期角色记忆。
- `src/lib/agent/chat-service.ts` 已经会读取 Agent 的 `role` 记忆并注入普通 Agent 对话。
- 状态机工作流 final review 已经会写入 `role` 记忆：
  - supervisor 复盘写入 supervisor 的 `role` 记忆。
  - score card 写入对应 Agent 的 `role` 记忆。
- 普通 Agent 聊天会写入 `chat` 记忆，保留单次会话补充上下文。

面向一人公司模式需要补齐：

- 增加统一全局开关，在系统设置中集中控制所有运行路径是否使用长期记忆。
- 增加 Agent 记忆管理 UI，让用户能查看、编辑、清空和应用候选。
- 增加基础记忆运行时注入预算，从“按条数读取”升级为“按最终注入内容预算读取”。
- 增加深层记忆数据库，承载长期对话事实、项目经验、用户偏好、重要决策和历史事件。
- 增加按需查询能力，让 AI 在需要背景信息时通过受控接口查询深层记忆。
- 将普通私聊、会议室和办公室的会话总结转化为可审核的 `role` 长期记忆候选。
- 让协作空间成员在绑定 Agent 后完整复用 Agent `role` memory。
- 增加去重、压缩、审计、回滚和候选确认流程。

因此本计划的记忆部分是“把现有多层记忆机制产品化，并升级为基础记忆、深层记忆库和统一查询入口”。

判断：

- 作为工程工作流的自动复盘记忆，现有机制基本够用。
- 作为一人公司模式的长期人格、偏好和协作经验记忆，需要补齐体验层、开关层、办公室接入层和深层检索层。
- 最优路线是保留底层 `memory-store` 入口，补齐全局开关、可视化管理、统一注入、深层检索、办公室接入和候选沉淀。

### 3.1 使用模式

新增全局用户偏好：

- `workspaceExperience.mode = "engineer" | "one-person-company"`
- `workspaceExperience.defaultEntry = "home" | "meeting-room" | "office" | "workflows" | ...`
- `agentMemory.runtimeEnabled = boolean`

推荐默认：

- 新用户首次引导选择“开发工程师界面”时：
  - `mode = "engineer"`
  - `defaultEntry = "home"`
  - 首页主导航/会话类型 tab 优先级调整为“对话、会议室、工作流”
  - `agentMemory.runtimeEnabled = false`
- 新用户首次引导选择“一人公司界面”时：
  - `mode = "one-person-company"`
  - `defaultEntry = "office"`
  - 首页主导航/会话类型 tab 优先级调整为“办公室、对话、工作流”
  - `agentMemory.runtimeEnabled = true`
- 老用户迁移：
  - 保持现状，默认等价于工程师模式。
  - 在系统设置中允许手动切换。

### 3.2 协作空间产品形态

协作空间是现有多人协作能力的新产品表达，按用户模式展示为不同心智：

- 工程师模式：展示为“会议室”，强调围绕问题、方案、评审、复盘组织一次协作会议。
- 一人公司模式：展示为“办公室”，强调常驻团队、工位、角色分工、长期记忆和持续协作。

底层继续使用同一套 room/session/message/participant 能力。产品层统一升级为更日常、更容易理解的协作空间概念。

### 3.2.1 普通模式：会议室

工程师模式下，协作空间展示为“会议室”。

页面目标：

- 作为普通多人 Agent 协作入口，适合临时讨论、方案评审、问题定位、复盘总结。
- 顶部提供创建会议入口：主题、参与 Agent、会议目标、是否沉淀记忆。
- 会议列表按最近活动、进行中、已归档组织。
- 会议详情沿用聊天式多方对话，但突出参会人、会议主题、结论和待办。

核心交互：

- 新建会议：选择一个主题和参与成员。
- 从 Agent 拉人：选择已有 Agent 作为参会成员。
- 会议中追加成员：把其他 Agent 拉入当前会议。
- 会议结论：结束时生成会议结论、待办和可审核记忆候选。
- 会议室历史：按主题、成员、项目和时间检索历史会议。

普通会议室默认导航：

- 工程师模式首页主 tab 顺序：对话、会议室、工作流。
- 会议室承接现有协作入口的普通模式用户可见文案。
- 会议室作为普通模式下的协作入口，同时保留工作流和普通对话的优先级。

### 3.2.2 一人公司模式：办公室

一人公司模式下，协作空间展示为“办公室”。底层继续使用现有协作会话能力，产品表达从“开一场讨论”升级为“经营一个虚拟团队”。

页面目标：

- 第一屏承载可直接操作的办公室，包括一句话运行、团队工位和当前协作状态。
- 顶部提供一句话运行入口，例如“帮我搭建一个 App 开发团队”。
- 中部展示公司角色蓝图，突出 CEO/Founder、产品、设计、工程、增长、运营、通才等角色。
- 下方或主体区域展示办公室工位，每个工位对应一个常驻成员或 Agent。
- 工位状态用头像、屏幕内容、状态色和简短状态文字表达，让用户一眼知道谁在空闲、谁在执行、谁在等待输入、谁在总结。

建议布局：

```text
┌─────────────────────────────────────────────┐
│ ACE Harness OPC Anywhere                     │
│ 一句话组织你的虚拟团队                         │
│ [ 帮我搭建一个 App 开发团队              运行 ] │
├─────────────────────────────────────────────┤
│ 公司角色蓝图：CEO / Product / Design / Eng... │
├─────────────────────────────────────────────┤
│ 办公室工位网格：6 个核心角色 + 可扩展成员       │
│ 每个工位显示头像、昵称、职责、当前状态、入口      │
└─────────────────────────────────────────────┘
```

核心交互：

- 一句话运行：根据用户目标生成或调整团队配置、建议角色、初始房间和下一步动作。
- 点击工位：打开与该成员的 direct room，也就是一人办公室房间。
- 拉人协作：在 direct room 中把其他成员加入同一个房间，形成多人办公室会议。
- 角色蓝图：用于解释团队构成，也作为快速筛选和创建成员的入口。
- 工位屏幕：显示该成员最近任务、正在看的工作流、最近产出或等待用户确认的事项。
- CEO/Founder 角色：可以由用户自己承担，也可以绑定一个协调型 Agent 作为总控成员。

默认角色建议：

- CEO / Founder：方向、优先级、关键决策、增长目标。
- Product Lead：需求、问题定义、价值验证、路线图。
- Design Lead：体验、交互、视觉和方案表达。
- Engineering Lead：实现、质量、架构和交付。
- Growth Lead：市场、内容、转化和用户增长。
- Operations Lead：流程、自动化、监控和效率。
- Generalist：临时任务、调研、补位和跨域执行。

组织架构图与组织管理要求：

- 架构图不是静态卡片展示，而是办公室的组织管理入口。它应支持像公司组织架构一样管理现有团队成员、岗位职责、汇报关系、职责边界、候选 Agent 和团队版本。
- 视觉目标参考“OPC Company Roles”式组织蓝图：顶部是 CEO / Founder 核心节点，右侧可显示 OPC Core / 组织原则；中间用清晰连线连接各角色；下方是 Product、Design、Engineering、Growth、Operations、Generalist 等角色卡；底部可展示 Powered by ACE Harness 的协作能力条。页面应更像可编辑组织图，而不是普通列表卡片。
- 每个组织节点包含：岗位名称、职责摘要、目标/关键结果、当前绑定 Agent、候选 Agent、直属上级、下属节点、协作关系、是否关键岗位、是否空缺、是否由用户本人承担。
- 支持组织管理操作：添加成员、删除成员、替换 Agent、重命名岗位职责、调整汇报关系、拖拽排序、从已有 Agent 手动选择、把一个 Agent 同时设置为多个岗位的临时负责人。
- 支持组织模板：一人 App 团队、内容增长团队、自动化运营团队、研究型团队、代码质量团队、个人 CEO + AI Copilot 团队。模板只是起点，用户可编辑。
- 架构图需要有编辑模式和展示模式。展示模式强调组织理解；编辑模式提供节点操作、候选列表、职责编辑、保存/撤销和版本对比。
- 组织变更不应直接覆盖 Agent 本体能力。组织节点保存岗位、职责和关系；Agent YAML 的 `workspaceProfile` 保存该 Agent 在办公室中的默认角色、常驻状态和展示偏好。
- 组织架构需要版本化：每次 AI 生成或用户调整形成一个 org draft，用户确认后才成为 current org；历史组织版本可查看、恢复或复制。

AI 组队与手动选人流程：

- 当前 `/api/office/team/plan` 的关键词/zone 打分只能作为 fallback，不能作为最终“生成团队”。正式流程应对齐 AI 引导创建工作流的产品模式：先澄清，再生成草案，再让用户编辑确认，最后才写入配置。
- 输入目标后，AI 先生成澄清问题，类似 `NewConfigModal` 的 workflow clarification：目标成果、首期范围、期望团队规模、是否需要用户亲自担任 CEO、偏技术/产品/增长/运营的权重、是否允许创建新 Agent、是否只从已有 Agent 中选择。
- 用户回答后，AI 输出组织草案，而不是直接落库。草案包含岗位节点、汇报关系、推荐 Agent、推荐理由、能力缺口、风险、可替代候选和建议下一步。
- 用户必须能手动选人：每个岗位打开候选 Agent 列表，按能力、标签、已有 `workspaceProfile`、memory 状态、最近使用、模型配置过滤；用户可固定某个 Agent、移除推荐、换人或创建新 Agent。
- AI 推荐必须给出可解释证据：命中的能力、命中的标签、相关记忆/历史工作流、与需求的匹配点、冲突或不足。只给一个 score 不够。
- “确认团队”应保存组织草案和成员绑定，并写回必要的 `workspaceProfile.residency.office`、`workspaceProfile.visual.zone/order`、`workspaceProfile.officeRole`。未确认前只预览，不修改 Agent YAML。
- 如果候选不足，系统应解释当前团队覆盖不足的能力和风险，而不是在架构图中编造固定空缺岗位；用户可手动添加已有 Agent 或进入 Agent 创建流程。
- 需要支持调整团队：在已有组织上做增量草案，展示 diff，例如新增岗位、移除岗位、替换 Agent、修改汇报关系、修改职责。

办公室视觉方向：

- 日常主界面优先使用“工位视图”：2x3 或响应式网格展示核心成员，每个成员坐在自己的工位上。
- 每个工位包含成员头像/剪影、角色色条、显示器预览、当前状态和一个主入口。
- 显示器预览展示该成员当前任务、最近产出、打开的项目或等待用户确认的事项。
- 角色色条承接产品、设计、工程、增长、运营、通才等职责颜色，帮助用户快速识别分工。
- 空闲、执行中、等待输入、总结中、休息等状态通过工位屏幕和状态徽标表达。
- 公司角色蓝图更适合放在首次引导、团队总览或 Agent 管理页，用来解释组织结构和补齐缺位角色。
- 顶部一句话运行入口始终可见，作为“给办公室派活”的主操作。
- 深色/浅色模式都使用同一套信息层级，颜色随主题切换，保证成员文字和状态在白天模式下也清晰可读。

办公室工位动画与交互要求：

- 工位由固定工作站层和可移动员工层组成。固定工作站包含地台、隔间后墙、桌面、椅子、屏幕、键盘、台灯和桌面物件；员工层独立叠放，便于在坐姿、站立、走动和交流状态之间切换。
- 隔间必须拆成后墙和左右前墙，桌面、屏幕和人物处在中间层，左右前墙只压住两侧边缘，形成参考图中的透视关系，避免整块前墙盖住桌面。
- 员工应支持这些一阶段状态：`seated_work`、`thinking_at_desk`、`standing_idle`、`walking_to_peer`、`talking_with_peer`。其中坐姿用于自己的工位，走动用于从自己的工位走到其他工位，交流用于停在同事工位旁。
- 走动不只是单帧位移，应播放帧动画；当前生成素材不足时允许先用 8 帧循环和 CSS 路径动画组合，后续替换成更完整的左右方向 walk cycle。
- 当前素材如果出现发型、脸型、服装或脚部锚点在帧间跳变，不能强行作为帧动画播放；短期应降级为单帧角色加路径移动/轻微步进，避免出现倒着走、腿不动但漂移、刘海忽有忽无等问题。
- 新的人物素材必须按角色和动作分批生成并验收：同一角色先固定 reference，再分别生成 `idle_left/right`、`walk_left/right`、`sit_work_left/right`；walk 至少 8 帧，脚底锚点一致，腿部相位清晰，返程或反方向必须使用对应朝向帧，不能依赖同一朝向倒放。
- 裁切流程必须固定单元格尺寸、帧宽、帧高和脚底基线，不能只靠连通域猜测行列；导出的 manifest 应包含 `frameWidth`、`frameHeight`、`frames`、`anchorX`、`anchorY`，CSS 动画按 manifest 的帧数配置。
- 屏幕内容不能只依赖原素材，应在显示器平面上叠加可控 SVG 覆盖层，展示不同 Agent 的动态状态，例如任务卡片、进度条、代码/文档线条、告警或总结图表。SVG 覆盖层应能按 `zone`、`activity`、等待输入等状态切换。
- 员工头顶使用悬浮定位标牌：圆形头像、名称、角色/状态短文本和朝下的小箭头，箭头指向员工当前位置。标牌随员工移动，hover/focus 时突出显示。
- 鼠标交互应友好：hover 工位或员工时高亮工作站、暂停/强调当前员工、显示角色和状态；点击员工或标牌时选中该成员，展示可执行动作，例如私聊、拉人协作、打开 Agent 配置、查看记忆、派发任务。
- 空办公室也要可操作：没有常驻成员时，用户仍可点击“生成团队”从 Agent YAML 生成候选团队；只有确认候选团队时才要求存在候选成员。
- 长远目标是让办公室从静态工位网格演进为轻量实时空间：成员可坐在自己工位思考/办公，站起来走到其他工位，与同事进行简短交流，再回到自己的工位继续工作。

协作空间与现有实现的关系：

- 现有协作房间能力作为协作空间内核继续使用。
- 用户可见文案、默认入口和导航名称按模式展示为“会议室”或“办公室”。
- 旧的房间、消息和参与者模型继续承载多人讨论、私聊、会议和办公室协作。
- 路由和 API 在迁移期兼容旧内部命名，前端产品文案逐步收敛到会议室/办公室。
- 新增功能优先使用 `collaboration`、`meeting-room`、`office`、`member`、`room` 这组命名。

建议命名映射：

```text
旧产品概念：议场        -> 新产品概念：协作空间
普通模式展示：会议室
一人公司展示：办公室
常驻嘉宾：常驻成员
嘉宾：成员 / 参会成员
议题：主题 / 会议主题 / 办公室任务
```

### 3.3 Agent 永久记忆

现有系统已经有 Agent 级长期记忆，后续升级应围绕这套机制展开。

当前相关实现：

- `src/lib/workflow/memory-store.ts`
  - `MemoryScope = 'role' | 'project' | 'workflow' | 'chat'`
  - `scope = role` 表示 Agent 长期角色记忆。
  - 底层文件位于 workspace data 的 `memory-layers/role/*.yaml`。
- `src/lib/agent/chat-service.ts`
  - 已读取 `scope: 'role', key: agentName`。
  - 已以“长期角色记忆”形式注入 Agent 对话。
- `src/app/api/workflow/status/route.ts`
  - 已向前端暴露 `memoryLayers.role`、`project`、`workflow`、`chat` 等分层状态。

存储层统一通过现有 `memory-store` 入口访问，Agent 长期记忆继续围绕 `scope = role` 管理。后续重点补齐基础记忆视图、深层记忆数据库、统一 resolver、预算控制和办公室接入。

目标模型：

- 基础记忆：每次运行都可注入的高信号短记忆，主要包括稳定身份、长期偏好、协作原则、常用约束、当前长期目标。
- 深层记忆库：长期沉淀的事实、事件、决策、对话结论、项目经验和历史产出，默认进入数据库索引，运行中由 AI 按需查询。
- 统一入口：外部 API 和运行时依赖 `memory-store` / memory resolver，通过统一抽象屏蔽 YAML、SQLite 和后续向量索引的底层差异。
- 统一权限：基础记忆和深层记忆都绑定 Agent、项目、工作流或会话 scope，并保留来源、时间、置信度、重要性和审计记录。

基础记忆建议结构：

```yaml
scope: role
key: architect
kind: base
content: |
  该 Agent 的长期身份、稳定偏好和协作原则。
charBudget: 5000
updatedAt: 2026-06-12T00:00:00.000Z
```

深层记忆建议结构：

```yaml
id: mem_xxx
scope: role
key: architect
kind: deep
title: 某次架构决策
summary: 简短摘要
content: 完整事实或事件记录
tags: [architecture, decision]
importance: 0.82
confidence: 0.76
source:
  type: chat | office | workflow | manual
  sessionId: ...
  runId: ...
createdAt: ...
updatedAt: ...
```

数据库建议：

- 第一阶段使用 SQLite 作为深层记忆索引库，配合 FTS 做关键词检索。
- 后续可以增加 embedding/vector 索引，保持查询 API 不变。
- YAML 文件继续承担可读、可迁移、可导出的记忆源数据；SQLite 负责索引、检索、排序和统计。
- `memory-store` 增加重建索引能力，把现有 `memory-layers/*/*.yaml` 同步进数据库索引。

规则：

- Agent 长期记忆继续使用 `scope = role`、`key = agentName`。
- 单个 Agent 的基础记忆运行时注入预算建议控制在 5000 字符以内。
- 深层记忆通过查询结果进入上下文，每次查询结果也需要独立预算。
- 现有 entry 模型可以保留，UI 提供“基础记忆合并视图”和“深层记忆列表/检索视图”。
- 保存基础记忆时进行预算校验；如果合并后的注入文本超过预算，应提示压缩或减少条目。
- 记忆条目需要支持查看、禁用/删除、清空、候选应用、重建索引和审计。
- 若未来升级为单文件 Markdown 展示形态，应通过 migration 映射到现有 `memory-store` 数据模型。

### 3.4 记忆沉淀与记忆使用分离

记忆分成两个动作：

- 沉淀：从对话、会议室、办公室、工作流执行结果中提炼长期有效信息，写入现有 `memory-store` 的对应 scope，并同步深层记忆索引。
- 使用：启动一次对话、会议室、办公室或工作流时读取基础 memory 并注入上下文；运行中按需查询深层 memory。

全局开关只控制“使用”：

```yaml
agentMemory:
  runtimeEnabled: true
  persistMode: review
```

推荐第一版 `persistMode = review`：

- 系统可以生成“记忆更新候选”。
- 用户确认后写入 `memory-store`，并更新深层记忆数据库索引。
- 保留审计记录和回滚入口。

后续可扩展：

- `manual`：只允许手动编辑。
- `review`：自动生成候选，用户确认。
- `auto`：自动写入，但保留审计和回滚。

沉淀后的分类建议：

- 长期稳定、会反复影响行为的内容进入基础记忆候选。
- 具体事件、历史决策、一次性上下文、会议纪要、项目事实进入深层记忆库。
- 深层记忆中被频繁查询且长期稳定的内容，可以由系统提议压缩进基础记忆。

## 4. 运行时记忆注入与按需检索设计

### 4.1 注入时机

启动一次会话时读取基础 memory 快照：

- 首页 Agent 对话：创建/恢复 Agent 会话时读取。
- 工作流步骤：该 Agent 执行步骤前读取。
- 会议室发言：参会成员绑定 Agent 时读取。
- 办公室发言：办公室成员绑定 Agent 时读取。
- 一人私聊：本质是协作空间 direct room，按会议室或办公室所在模式读取。

建议每个运行会话使用启动时快照，同一轮运行中保持这份快照稳定，下一轮新会话再读取最新记忆。

### 4.2 注入位置

在 Agent system prompt 后、当前任务上下文前追加：

```text
<agent-memory>
以下是该 Agent 的基础长期记忆，仅用于保持长期偏好、经验和已知背景。
...
</agent-memory>
```

要求：

- 当 `agentMemory.runtimeEnabled = false` 时不注入。
- 当 `role` scope 没有可用记忆条目时不注入。
- 注入内容需要在日志/调试视图中可追踪；普通用户 UI 默认展示摘要和来源，完整长期记忆放在 Agent 记忆管理界面查看。

### 4.3 深层记忆按需查询

会话启动时只注入基础记忆，深层记忆通过查询接口进入上下文。

建议提供内部工具或 server-side resolver：

```ts
queryAgentMemory({
  agentName,
  query,
  scopes: ['role', 'project', 'workflow', 'chat'],
  tags,
  limit: 8,
  maxChars: 4000
})
```

查询返回：

- `memoryId`
- `scope`
- `key`
- `title`
- `summary`
- `contentSnippet`
- `source`
- `confidence`
- `importance`
- `updatedAt`

使用策略：

- AI 需要历史背景、用户偏好、长期项目事实、历史决策或过往产出时触发查询。
- 服务端可在用户问题明显涉及历史上下文时预先查询一轮，减少模型工具调用成本。
- 查询结果以 `<retrieved-memory>` block 注入当前轮，不写回基础记忆。
- 每次查询都有独立字符预算，默认建议 3000-5000 字。
- 调试视图展示本轮查询词、命中条目和被注入的摘要。

### 4.4 记忆查询工具提示

需要给 AI 一个简短、正向的工具说明：

```text
你可以在需要历史背景、长期偏好、过往决策或项目经验时查询 Agent 深层记忆。
查询结果带有来源和时间，只把与当前问题直接相关的内容用于回答或执行。
```

### 4.5 记忆安全

需要在写入和注入前处理：

- `memory-store` 的 scope/key 校验，禁止绕过 `role` scope 或写入异常 key。
- 字符数限制。
- 明确标记 memory 来源。
- 记忆候选写入前展示 diff。
- 提供“清空记忆”和“恢复上一版”入口。
- 深层记忆查询结果需要带来源，支持从结果跳回原始会话、会议室、办公室房间或工作流 run。

## 5. 协作空间成员与 Agent 关系

### 5.0 Agent YAML 作为统一配置源

所有 Agent 都继续使用 `configs/agents/*.yaml` 作为唯一配置源。会议室成员、办公室成员、工作流步骤和首页对话都引用同一份 Agent YAML，不再为协作空间复制一套独立人设配置。

现有 Agent YAML 已经包含：

- `name`
- `team`
- `roleType`
- `avatar`
- `title`
- `persona`
- `greeting`
- `engineModels`
- `activeEngine`
- `temperature`
- `capabilities`
- `systemPrompt`
- `iterationPrompt`
- `constraints`
- `skills`
- `allowedTools`
- `category`
- `tags`
- `specialtyTags`
- `alwaysAvailableForChat`
- `keywords`
- `description`
- `mcpServers`

协作空间应把这些字段视为 Agent 的“本体配置”：

- 头像、模型、system prompt、skills、tools、能力描述都从 Agent YAML 读取。
- 工作流、会议室、办公室只保存 Agent 引用、房间状态和会话级临时覆盖项。
- 修改 Agent 本体能力时只写回 Agent YAML。
- 修改常驻成员昵称、工位位置、办公室职责时写回 Agent YAML 的 `workspaceProfile`。

建议给 Agent YAML 增加一个可选的 `workspaceProfile` 字段，用来承载跨会议室/办公室都可复用的展示、常驻和协作偏好：

```yaml
workspaceProfile:
  displayName: 架构师
  nickname: 老周
  officeRole: engineering-lead
  residency:
    office: true
    meetingRoom: false
    defaultDirectRoom: true
  roomPresence:
    recommendForMeetingRoom: true
    autoShowInOffice: true
  visual:
    accent: orange
    deskVariant: focus
    desk: desk-1
    order: 10
  memory:
    baseBudget: 5000
    deepSearchEnabled: true
```

字段语义：

- `displayName`：Agent 在协作空间中的默认展示名，成员可用 nickname 临时覆盖。
- `nickname`：Agent 在协作空间中的默认昵称，用于办公室工位、会议室成员卡和 direct room 标题。
- `officeRole`：一人公司办公室中的默认职责。
- `residency.office`：是否作为办公室常驻成员展示。
- `residency.meetingRoom`：是否作为会议室常驻/推荐成员展示。
- `residency.defaultDirectRoom`：是否在成员卡上提供默认私聊入口。
- `roomPresence.recommendForMeetingRoom`：创建普通会议室时是否优先推荐。
- `roomPresence.autoShowInOffice`：进入办公室时是否默认显示在工位区。
- `visual.accent`：工位或成员卡默认角色色。
- `visual.deskVariant`：工位视觉偏好，例如 focus、creative、ops、analysis。
- `visual.desk`：办公室默认工位。
- `visual.order`：成员排序。
- `memory.baseBudget`：该 Agent 基础记忆注入预算。
- `memory.deepSearchEnabled`：该 Agent 是否启用深层记忆按需查询。

这组字段全部是可选增强项。缺省时继续按现有 `team / roleType / avatar / tags / category` 推导展示效果。

### 5.1 成员字段设计

协作空间成员是 Agent YAML 的运行时投影。普通模式中展示为会议成员，一人公司模式中展示为办公室成员。

常驻关系直接在 Agent YAML 的 `workspaceProfile.residency` 中配置：

- `office: true` 表示该 Agent 是办公室常驻成员。
- `meetingRoom: true` 表示该 Agent 是会议室常驻或推荐参会成员。
- `defaultDirectRoom: true` 表示该 Agent 可以从成员卡直接开启私聊。

房间参与者只保存本次会话的引用和少量会话级临时覆盖项。

建议字段：

```yaml
agentName: architect
participantKind: resident | temporary
displayOverride:
  roomAlias: 老周
  roomRole: 技术方案评审
```

字段语义：

- `agentName`：指向 `configs/agents/*.yaml` 的 Agent 名称。
- `participantKind`：本次房间中的参与类型，常驻成员或临时参会成员。
- `displayOverride`：本次房间内的临时展示覆盖项，例如会议内称呼或参会身份。

协作空间成员运行时解析顺序：

1. 读取 `agentName` 对应的 Agent YAML。
2. 应用 Agent YAML 的 `workspaceProfile`。
3. 应用房间参与者自己的 `displayOverride`，只影响当前房间。
4. 生成运行时 `memberRuntimeConfig`，供 UI、聊天、模型调用和记忆 resolver 使用。

需要保存快照的场景使用 `agentSnapshot` 字段，仅用于历史房间回放和 Agent 删除后的展示兜底。新会话始终优先读取最新 Agent YAML。

### 5.2 在 Agent 中设置常驻成员

Agent 编辑页增加“协作空间”配置区，直接写入 Agent YAML 的 `workspaceProfile`。

建议 UI：

1. 打开 Agent 编辑弹框。
2. 展示“协作空间”分组。
3. 可设置：
  - 协作空间显示名。
  - 昵称。
  - 办公室职责。
  - 是否办公室常驻。
  - 是否会议室推荐成员。
  - 是否允许成员卡直接私聊。
  - 角色色、工位偏好、排序。
  - 基础记忆预算和深层记忆查询开关。
4. 保存后更新该 Agent 的 YAML。

保存后：

- 成员头像默认跟随 Agent。
- 成员系统提示词默认跟随 Agent。
- 成员模型配置默认跟随 Agent。
- 成员 memory 默认跟随 Agent，但是否注入仍由全局开关决定。
- 成员昵称保存在 Agent YAML 的 `workspaceProfile.nickname`，不修改 Agent `name`。
- 成员职责用于办公室组织展示和默认协作编排；会议室使用会议主题和参会身份组织展示。
- 成员 skills 默认跟随 Agent YAML 的 `skills`；协作空间不提供独立 skills 配置入口。
- 如果用户需要改变成员可用 skills，应进入 Agent 编辑页修改 Agent YAML。

### 5.3 配置入口与历史快照

成员卡和房间参与者详情提供：

- 打开 Agent 配置。
- 编辑 Agent 的协作空间配置。
- 修改昵称、办公室职责和工位偏好时写回 Agent YAML 的 `workspaceProfile`。
- 设置当前房间内临时称呼或参会身份时写入房间参与者的 `displayOverride`。

冲突处理：

- Agent 被删除：历史房间使用 `agentSnapshot` 展示，新的常驻列表自动移除该成员。
- Agent memory 超限：该成员运行时按基础记忆截断或无长期记忆上下文启动，并展示配置警告。
- Agent 模型失效：沿用现有模型 fallback 规则。

## 6. 私聊即协作空间 direct room

### 6.1 产品定义

常驻成员点击后支持直接创建私聊对话。

这个私聊是协作空间房间的一种轻量形态：

- 初始只有 1 个成员。
- 默认没有主题。
- 用户可以直接发消息。
- 后续可以继续拉其他成员加入。
- 一旦加入多个成员，就自然变成会议室会议或办公室会议。

### 6.2 房间模型

建议复用现有 session/room 数据结构，增加轻量字段：

```yaml
spaceType: meeting-room | office
roomType: direct | meeting
topic: ""
participants:
  - memberId: member-architect
createdFrom: residentMember
```

规则：

- `roomType = direct` 只表示初始形态，不限制后续加人。
- 当参与者数量大于 1 时，可以自动显示为会议。
- `topic` 允许为空。
- 标题默认使用成员昵称或显示名，例如“和老周聊聊”。

### 6.3 UI 入口

常驻成员卡片新增主操作：

- 点击卡片：打开/创建与该成员的私聊房间。
- 更多菜单：打开 Agent 配置、改昵称、改职责、调整工位、从办公室隐藏。

私聊房间中提供：

- 拉人按钮。
- 设置主题按钮。
- 设置为会议主题或办公室任务按钮。
- 打开成员对应的 Agent 配置。
- 查看/编辑该 Agent 记忆。

## 7. 首次引导与一人公司设置

### 7.1 首次登录选择

在首次管理员/用户设置完成后，增加体验选择：

标题建议：

```text
你想怎么使用 ACEHarness？
```

选项：

- 开发工程师界面
  - 保持当前工具台体验。
  - 默认不让 Agent 记忆参与推理。
  - 适合工作流、工程执行、代码任务。
- 一人公司界面
  - 默认进入办公室。
  - 启用 Agent 记忆参与推理。
  - 常驻成员组成你的个人 AI 团队。

用户选择后写入系统设置。

### 7.2 一人公司引导

第一次进入一人公司模式时展示办公室引导：

1. 介绍已有常驻成员和公司角色蓝图。
2. 说明可以点击工位或成员直接私聊。
3. 说明可以拉其他成员加入同一房间。
4. 说明 Agent 记忆已启用，并可在系统设置关闭。
5. 引导创建或调整常驻成员：
  - 起昵称。
  - 选择或创建 Agent。
  - 在 Agent 配置中勾选办公室常驻。
  - 创建新 Agent 并设为常驻成员。
  - 选择办公室职责。
  - 选择默认协作风格。
6. 引导用户用一句话创建或调整团队，例如“帮我搭建一个 App 开发团队”。

引导必须可跳过，跳过后可从设置中重新打开。

## 8. 系统设置

系统设置中新增“一人公司 / 记忆”分组。

配置项：

- 默认界面：
  - 工程师模式
  - 一人公司模式
- 默认入口：
  - 首页
  - 会议室
  - 办公室
  - 工作流
- Agent 记忆参与推理：
  - 开启/关闭
- 记忆沉淀模式：
  - 手动
  - 审核后写入
  - 自动写入
- 查看记忆目录。
- 清空所有 Agent 记忆。
- 导出所有 Agent 记忆。

需要明确文案：

```text
关闭“记忆参与推理”会保留已沉淀的记忆，新对话、会议室、办公室和工作流将按无长期记忆上下文启动。
```

## 9. API 与存储拆解

### 9.1 Agent memory API

基于现有 `memory-store` 扩展 Agent 记忆管理能力。

建议新增或扩展面向 Agent 的便捷 API：

- `GET /api/agents/:name/memory`
- `PUT /api/agents/:name/memory`
- `POST /api/agents/:name/memory/propose`
- `POST /api/agents/:name/memory/apply`
- `DELETE /api/agents/:name/memory`

这些 API 内部都读写：

```ts
scope: 'role'
key: agentName
```

返回中包含：

- `entries`
- `mergedContent`
- `charCount`
- `maxChars`，默认 5000
- `baseMemory`
- `deepMemoryStats`
- `updatedAt`
- `storageScope: "role"`
- `storageKey: agentName`
- `overLimit`

### 9.2 Deep memory API

基于 `memory-store` 增加深层记忆检索能力。

建议 API：

- `POST /api/memory/query`
- `POST /api/memory/reindex`
- `GET /api/agents/:name/memory/deep`
- `POST /api/agents/:name/memory/deep`
- `PATCH /api/memory/items/:id`
- `DELETE /api/memory/items/:id`

查询参数：

```ts
interface MemoryQueryRequest {
  query: string;
  scopes?: Array<'role' | 'project' | 'workflow' | 'chat'>;
  agentName?: string;
  projectRoot?: string;
  workflowId?: string;
  tags?: string[];
  limit?: number;
  maxChars?: number;
}
```

返回中包含命中条目、来源、排序原因和被截断后的注入文本。

数据库表建议：

- `memory_items`：记忆主体、scope、key、title、summary、content、tags、source、importance、confidence、createdAt、updatedAt。
- `memory_fts`：FTS 索引。
- `memory_links`：关联到 session、run、room、artifact、文件路径。
- `memory_audit_logs`：创建、编辑、应用候选、删除和恢复记录。

### 9.3 System settings API

扩展现有系统设置：

```ts
type WorkspaceExperienceMode = 'engineer' | 'one-person-company';

interface AgentMemorySettings {
  runtimeEnabled: boolean;
  persistMode: 'manual' | 'review' | 'auto';
}

interface WorkspaceExperienceSettings {
  mode: WorkspaceExperienceMode;
  defaultEntry: 'home' | 'meeting-room' | 'office' | 'workflows';
  onePersonCompanyOnboardingSeen?: boolean;
}
```

### 9.4 Collaboration space API

扩展协作空间成员与房间，底层可继续复用现有协作数据结构：

- `GET /api/collaboration/members?spaceType=meeting-room|office`
- `POST /api/agents/:name/workspace-profile`
- `PATCH /api/agents/:name/workspace-profile`
- `POST /api/collaboration/rooms/direct`
- `POST /api/collaboration/rooms/:id/participants`
- `POST /api/collaboration/rooms/:id/finish`
- `GET /api/collaboration/rooms`
- `GET /api/collaboration/rooms/:id`
- `POST /api/office/team/plan`（当前 heuristic fallback，保留用于无模型或快速预览）
- `POST /api/office/org/clarify`
- `POST /api/office/org/draft`
- `PATCH /api/office/org/draft/:id`
- `POST /api/office/org/apply`
- `GET /api/office/org/current`
- `GET /api/office/org/versions`
- `POST /api/office/org/versions/:id/restore`

其中 `members` 从 Agent YAML 的 `workspaceProfile.residency` 派生常驻/推荐成员，`workspace-profile` 更新 Agent YAML，`direct` 创建一人 direct room，`spaceType` 决定前端展示为会议室或办公室。正式组队由 `org/clarify -> org/draft -> org/apply` 承载，`team/plan` 只作为当前本地打分 fallback。

组织草案数据建议：

```yaml
officeOrg:
  id: org-xxx
  status: draft | current | archived
  requirement: 用户目标
  nodes:
    - id: ceo
      title: CEO / Founder
      zone: core
      reportsTo: null
      responsibilities: []
      agentName: ceo-founder
      candidateAgentNames: []
      vacancy: false
      evidence: []
  edges:
    - from: ceo
      to: product
      kind: reports_to
  gaps: []
  generationTrace:
    mode: ai | manual | heuristic
    clarificationAnswers: {}
    model: ""
    createdAt: 0
```

## 10. 前端改造点

### 10.1 Onboarding

- 首次设置结束页增加体验选择。
- 老用户沿用当前体验，可在系统设置中主动切换。
- 设置中允许切换体验模式。

### 10.2 Home / Layout

- 根据 `workspaceExperience.defaultEntry` 控制默认入口。
- 一人公司模式下侧边栏和首页主 tab 优先展示办公室。
- 一人公司模式下首页主 tab 排序调整为：办公室、对话、工作流。
- 工程师模式下首页主 tab 维持工具台优先级：对话、会议室、工作流。
- 工程师模式保持现状。

### 10.3 Agent 页面

- Agent 编辑弹框增加“永久记忆”入口。
- Agent 编辑弹框增加“协作空间”配置区，用于设置昵称、办公室职责、是否办公室常驻、是否会议室推荐、工位偏好和排序。
- Agent 卡片显示 memory 状态。
- Agent 卡片显示协作空间状态，例如“办公室常驻”“会议室推荐”。
- 支持打开 `role` memory 编辑器，底层读写现有 `memory-store`。
- 显示 `charCount / 5000`。

### 10.4 协作空间成员

- 成员卡支持昵称。
- 成员卡点击创建/打开 direct room。
- 成员列表从 Agent YAML 的 `workspaceProfile.residency` 派生。
- 成员详情提供打开 Agent 编辑页的入口。
- 私聊房间支持拉人。

### 10.5 组织架构管理

- `/office` 的“团队架构”改为组织管理面板，而不是普通卡片列表。
- 支持展示模式：CEO 核心节点 + 角色节点 + 汇报连线 + OPC Core 说明 + Powered by 能力条，视觉接近组织蓝图。
- 支持编辑模式：新增/删除岗位、修改职责、调整汇报关系、拖拽排序、保存、撤销、查看草案 diff。
- 每个岗位节点可打开详情抽屉：岗位职责、当前 Agent、候选 Agent、匹配证据、空缺状态、历史变更。
- 候选 Agent 抽屉支持手动选择、搜索、按标签/能力/模型/常驻状态过滤。
- 生成团队流程改为多步骤：输入目标 -> AI 澄清问题 -> 组织草案 -> 用户手动调整 -> 确认应用。
- 确认应用前只更新页面预览，不写 Agent YAML；确认后才调用 `org/apply`。
- 如果没有可用 Agent，展示空团队状态和“添加现有 Agent / 创建 Agent”的入口，不禁用整个流程。

### 10.6 系统设置

- 增加体验模式设置。
- 增加 Agent 记忆设置。
- 增加记忆清理/导出入口。

## 11. 后端运行时改造点

### 11.1 Memory resolver

收敛现有记忆读取逻辑，将各运行时入口统一到同一个构建流程。

- 输入 Agent name。
- 从现有 `memory-store` 读取 `scope = role` 的 Agent 长期记忆。
- 可选读取 `project`、`workflow`、`chat` 层记忆。
- 应复用或迁移 `src/lib/agent/chat-service.ts` 里的 `buildAgentMemoryContext`。
- 控制每个 Agent 的角色记忆注入预算，默认 5000 字符以内。
- 根据系统设置决定是否返回注入块。

所有运行时入口复用该模块，统一 prompt 中 memory block 的格式、预算和开关行为。

### 11.2 Memory proposer

新增记忆候选生成模块：

- 输入会话摘要、Agent name、当前 `role` memory entries。
- 输出候选 entries 或对现有 entries 的 patch。
- 需要限制总长度。
- 需要展示 diff。

第一阶段可以只做手动保存，不接入自动 proposer。

### 11.3 Collaboration room adapter

直接私聊复用协作空间 room：

- 创建 direct room。
- participant 初始只有一个。
- topic 默认为空。
- 支持后续添加 participant。
- 根据 `spaceType` 输出会议室或办公室的 UI 文案和默认行为。

### 11.4 Office org planner

正式组织设计器对齐 AI 引导创建工作流的实现思路：

- 复用结构化结果通道：定义 `office_org_clarification_question`、`office_org_draft`、`office_org_node`、`office_org_assignment`、`office_org_gap` 等 kind。
- 复用工作流创建器的阶段模型：clarification、draft、review/apply。每个阶段保存 session/draft，支持恢复和继续编辑。
- 输入可用 Agent 列表、Agent YAML 摘要、`workspaceProfile`、标签、能力、memory 摘要和用户目标，输出组织草案。
- 输出必须包含推荐依据和风险，不允许只输出成员列表。
- 支持 manual-only 模式：用户不用 AI，也可以从岗位模板开始手动选人。
- 支持 hybrid 模式：AI 先生成岗位和建议，用户手动锁定/替换候选。
- `team-planner.ts` 当前关键词打分逻辑保留为 fallback 和候选排序辅助，但不能作为最终确认逻辑。

## 12. 测试计划

### 12.1 单元测试

- `memory-store` 的 `role` scope 读写不回归。
- `role` memory 合并内容超过 5000 字时保存或应用候选失败。
- `runtimeEnabled = false` 时不注入 memory。
- `runtimeEnabled = true` 且 memory 存在时注入。
- 现有 Agent 对话的长期角色记忆注入迁移为统一 resolver 负责，保证每轮只注入一次。
- `team=black-gold` 和 supervisor 校验不回归。
- `workspaceProfile` 可选字段解析、保存和回读稳定。
- 成员昵称写入 Agent YAML 的 `workspaceProfile.nickname`，不修改 Agent `name`。
- Agent 删除后历史房间使用 `agentSnapshot` 展示。
- office org planner 在缺少匹配 Agent 时产生 vacancy，而不是低相关随机补位。
- office org planner 的推荐结果包含 evidence、risk、candidateAgentNames 和 reportsTo。
- manual-only 组织草案可以不调用模型，直接从用户选择生成。

### 12.2 API 测试

- 获取 Agent memory。
- 写入 Agent memory。
- 清空 Agent memory。
- Agent memory API 内部使用 `scope = role`、`key = agentName`。
- 更新 Agent `workspaceProfile`。
- 根据 `workspaceProfile.residency` 获取会议室/办公室成员列表。
- 创建 direct room。
- direct room 添加第二个成员。
- `POST /api/office/org/clarify` 生成可回答的澄清问题。
- `POST /api/office/org/draft` 生成组织草案但不写 Agent YAML。
- `PATCH /api/office/org/draft/:id` 可手动替换岗位 Agent。
- `POST /api/office/org/apply` 确认后才写回 `workspaceProfile`。

### 12.3 组件测试

- 首次引导选择工程师模式。
- 首次引导选择一人公司模式。
- Agent 编辑弹框 memory 计数。
- Agent 编辑弹框协作空间设置。
- 常驻成员卡点击创建私聊。
- 成员昵称展示优先级。
- 系统设置切换 memory runtime 开关。
- 组织架构图展示 CEO 核心节点、角色节点和汇报连线。
- 组织架构编辑模式可新增岗位、调整汇报关系、手动选择 Agent。
- 生成团队流程显示 AI 草案、候选证据、能力覆盖风险和确认按钮。

### 12.4 端到端测试

- 新用户选择一人公司模式后默认进入办公室。
- 工程师模式下协作入口显示为会议室。
- 点击常驻成员创建 direct room。
- 在私聊里拉入第二个成员。
- 开启 memory 后 Agent 发言包含 memory 注入。
- 关闭 memory 后新会话按无长期记忆上下文启动。
- 工程师模式保持当前默认入口。
- 用户输入目标后先进入组织草案预览，未确认前刷新不会写入常驻成员。
- 用户手动替换一个岗位 Agent 后确认团队，办公室和 Agent YAML 同步更新。

## 13. 迁移与兼容

### 13.1 老用户

- 老用户继续沿用当前模式，系统设置中提供切换入口。
- 默认保持工程师模式。
- `agentMemory.runtimeEnabled` 默认 false。
- 已有常驻成员数据迁移为对应 Agent YAML 的 `workspaceProfile.residency` 和 `workspaceProfile.nickname`。

### 13.2 现有 Agent

- Agent YAML 增加可选 `workspaceProfile` 字段，现有 Agent 配置继续可读。
- 继续使用现有 `memory-layers/role` 作为 Agent 长期记忆来源。
- 没有 role memory 的 Agent 视为空记忆。
- 需要提供一次性检查，确认现有 role memory 在新 UI 中可见。
- 需要提供一次性迁移，将现有常驻嘉宾/常驻成员引用写回对应 Agent 的 `workspaceProfile`。

### 13.3 现有协作房间

- 现有 room 数据继续可读。
- 新 direct room 增加 `spaceType` 和 `roomType` 字段。
- 没有 `roomType` 的旧房间按 `meeting` 处理。
- 没有 `spaceType` 的旧房间在工程师模式展示为会议室，在一人公司模式展示为办公室。

## 14. 分阶段实施

### Phase 1：基础设置与现有记忆能力收敛

目标：

- 引入系统设置结构。
- 复用现有 `memory-store` 的 `role` scope。
- 实现 Agent memory 便捷 API。
- 实现 5000 字运行时注入预算和保存/应用候选校验。
- 明确普通 Agent 对话、工作流、会议室和办公室都统一通过 memory resolver 拼接长期记忆。

验收：

- 可以在 Agent 编辑页查看、编辑、清空现有 role memory。
- 关闭 runtime 开关时按无长期记忆上下文启动。
- 开启 runtime 开关时新会话可注入 memory。
- 现有 Agent 聊天长期角色记忆能力迁移到统一 resolver 后保持行为一致。
- 当前已有 `memory-layers/role/*.yaml` 数据在新 UI 中可见。

### Phase 2：运行时统一注入

目标：

- 抽取统一 memory resolver。
- 首页 Agent 对话改为接入 memory resolver。
- 工作流 Agent 执行改为接入 memory resolver。
- 协作空间成员接入 memory resolver。
- resolver 内部根据全局 `agentMemory.runtimeEnabled` 决定是否读取并注入。

验收：

- 三条运行路径都复用同一 memory resolver。
- 日志中可定位 memory 是否参与。
- 关闭 runtime 开关后三条路径都不注入。
- 首页 Agent 对话改为使用统一 role memory 拼接逻辑。
- 一人公司模式下 direct room、办公室会议与普通会议室成员都能读取同一份 role memory。

### Phase 3：一人公司 onboarding

目标：

- 首次登录后增加体验选择。
- 系统设置支持切换模式。
- 一人公司模式默认进入办公室。
- 一人公司模式下首页主 tab 将办公室排在第一位。
- 工程师模式下协作入口展示为会议室。

验收：

- 新用户选择工程师模式后体验不变。
- 新用户选择一人公司模式后默认进入办公室。
- 新用户选择一人公司模式后首页主 tab 顺序为“办公室、对话、工作流”。
- 工程师模式和老用户仍保持当前工具台优先级，并将协作入口显示为“会议室”。
- 老用户沿用当前入口，后续可在设置中切换。

### Phase 4：Agent 驱动协作空间成员

目标：

- Agent YAML 支持 `workspaceProfile`。
- Agent 编辑页支持设置昵称、办公室职责、办公室常驻、会议室推荐、工位偏好和排序。
- 协作空间成员列表从 Agent YAML 派生。
- 现有常驻嘉宾/常驻成员数据迁移到 Agent YAML。

验收：

- 勾选 `workspaceProfile.residency.office` 后，该 Agent 出现在办公室常驻成员列表。
- 勾选 `workspaceProfile.residency.meetingRoom` 后，该 Agent 出现在会议室推荐成员列表。
- 成员使用 Agent 头像、模型、systemPrompt、skills 和 memory。
- 修改昵称只更新 `workspaceProfile.nickname`，Agent `name` 保持稳定。
- 旧常驻嘉宾数据迁移后能在 Agent 编辑页看到对应配置。

### Phase 4.5：组织架构管理与 AI 组队草案

目标：

- `/office` 团队架构升级为可编辑组织架构图。
- 新增 office org draft 数据结构和 API。
- 生成团队流程从 heuristic 选择升级为 AI 澄清 + 组织草案 + 用户手动确认。
- 支持用户手动选择 Agent、锁定 Agent、添加成员、替换成员和创建新 Agent。
- 当前 `team-planner.ts` 关键词打分逻辑降级为 fallback 和候选排序辅助。

验收：

- 架构图能展示 CEO 核心节点、角色节点、汇报线和岗位详情。
- 用户可以新增、删除、重命名岗位并调整汇报关系。
- 输入目标后先生成组织草案，不直接写 Agent YAML。
- 每个推荐 Agent 都显示匹配证据、风险和备选候选。
- 用户手动替换岗位 Agent 后，草案和架构图立即更新。
- 确认草案后才写回 `workspaceProfile` 并更新办公室成员。

### Phase 5：协作空间 direct room

目标：

- 点击常驻成员创建 direct room。
- direct room 默认无主题。
- direct room 可继续拉人。

验收：

- 一个成员可直接开始聊天。
- 加第二个成员后自然变成会议室会议或办公室会议。
- 私聊沿用协作空间 room/session/message 机制。

### Phase 6：记忆沉淀候选

目标：

- 会话结束、会议室结束、办公室会议结束或用户主动触发时生成 memory 更新候选。
- 普通私聊、会议室和办公室先生成 `role` 长期记忆候选，用户确认后写入。
- 展示 diff。
- 用户确认后写入。

验收：

- 候选以待审核状态呈现，确认后再更新 memory。
- 超过 5000 字时提示用户压缩。
- 可审计、可回滚。
- 候选写入现有 `memory-store` 的 `role` scope。
- 拒绝候选时保留现有 `chat` 会话记忆。

## 15. 风险与对策

### 15.1 记忆污染

风险：AI 把一次性路径、错误判断、敏感信息写入长期记忆。

对策：

- 默认 `persistMode = review`。
- 写入前展示 diff。
- 提供清空和恢复。
- 系统提示约束“只沉淀长期稳定偏好和事实”。

### 15.2 上下文膨胀

风险：每个 Agent 都注入最多 5000 字，工作流并发时 prompt 变大。

对策：

- 5000 作为运行时注入硬上限，UI 推荐 1000-2000 字的高信号记忆。
- UI 提醒推荐 1000-2000 字。
- 后续可做 memory 摘要层。

### 15.3 产品入口混乱

风险：一人公司模式和工程师模式互相干扰。

对策：

- 老用户默认不迁移。
- 模式选择只影响默认入口和 memory runtime 默认值。
- 所有功能仍可从系统设置切换。

### 15.4 Agent 配置驱动的展示来源不清晰

风险：用户不知道成员卡、办公室工位和会议室推荐来自哪一份 Agent YAML 配置。

对策：

- 成员卡显示对应 Agent 名称和配置入口。
- Agent 编辑页集中展示“协作空间”配置。
- 房间历史使用 `agentSnapshot` 稳定回放，当前办公室和会议室列表读取最新 Agent YAML。

## 16. 建议的第一批最小可交付

如果要尽快落地，推荐先做：

1. 系统设置增加 `agentMemory.runtimeEnabled`。
2. 基于现有 `memory-store` 做 Agent role memory 编辑 UI 和 5000 字预算。
3. 运行时 memory resolver，先把首页 Agent 对话和协作空间统一到同一套读取逻辑。
4. Agent YAML 增加 `workspaceProfile`，支持常驻成员昵称和办公室职责。
5. 常驻成员点击创建 direct room。
6. 一人公司模式默认入口和首次引导。

工作流 memory 注入统一和自动沉淀可以放到下一批，让第一版先完成会议室/办公室入口、direct room 和 Agent role memory 可视化。
