# 统一画布、轻量工作流与 Agent 市场详细设计

Updated: 2026-11-28

## 1. 目标和设计结论

本设计解决三个相互关联的问题：

1. 轻量工作流从“一个 Agent 加任务清单”扩展为可视化的多节点、多 Agent、脚本编排。
2. 状态机编辑器采用同一套画布视觉和交互，但保留状态内多步骤、并发、审核和状态转移能力。
3. 轻量工作流可以把另一个轻量工作流或状态机工作流作为 `Subworkflow` 节点调用。
4. 在 Agent 页面内增加 Agent 市场，支持从代码仓库搜索、安装、更新和回滚 Agent；技能市场仍然只负责 Skill。
5. 增加 `aceharness-skill-to-workflow`，把满足条件的流程型 Skill 转换成可审阅的轻量工作流，并把运行节点、任务清单、证据和产物投影到现有看板。

核心结论是：**统一编辑器和画布数据结构，复用现有状态机执行设施，通过编译器把画布图映射到现有运行配置；不新建一套并行运行时。**

本阶段只确定协议、边界、迁移方式和实施任务，不修改业务代码。

## 2. 当前实现基线

### 2.1 轻量工作流

当前轻量模式由 `src/lib/workflow/lightweight.ts`、`src/lib/ai/workflow-creation-items.ts` 和 `src/lib/core/schemas.ts` 共同约束：

- 一个状态同时作为初始状态和终态。
- 只有一个 Agent 步骤。
- 没有状态转移。
- 旧配置不允许 Script 和 Subworkflow 步骤；新的画布执行 profile 将通过编译边界逐步放开这些节点。
- 自动带有 `aceharness-tasklist` 技能。
- 任务由任务清单动态拆分、调度和验收。

编辑页 `LightweightWorkflowDesignPanel` 当前只编辑一个 Agent 和一段任务描述。它更接近“任务清单入口”而不是流程图。

当前轻量运行已经有 `LightweightTaskBoard`、`LightweightTaskExecutionGraph` 和任务证据适配器，可展示真实 Agent 活动、任务依赖、串并行关系和完成度。新设计应扩展这条证据链，而不是另建看板状态系统。

### 2.2 状态机工作流

状态机已经有目标能力的执行基础：

- 多状态和多步骤。
- Agent、Script、Subworkflow。
- 状态转移和转移条件。
- 状态内并行组和并发元数据。
- 状态级审核/对抗策略。
- 现有 React Flow 图形面板和节点检查器。

因此轻量升级的重点是表达和编译，不是重新实现执行器。

### 2.3 参考组件的可复用部分

粘贴的 `interactive-workflow-blueprint` 组件提供了适合作为视觉参考的结构：

- 点阵画布。
- 带图标、类型标签、说明和工具标签的节点卡片。
- 节点选中态和边连接态。
- 右侧 `Connection stack`，可将动作添加到当前节点后面。
- 底部缩放、适应画布、暂停动画和节点/连接数量。
- 选中节点后的编辑区。

它使用 `@xyflow/react`，而当前仓库使用 `reactflow`。实施时应保留现有主技术栈和 React Flow Provider，只迁移交互结构、卡片布局、连接栈和视觉 token。

## 3. 统一画布数据结构

### 3.1 分层

画布数据分三层：

```text
Canvas Document（可编辑、带位置）
        ↓ 编译/校验
Canvas IR（稳定、与运行时字段对应）
        ↓ 适配
Existing Workflow Config（现有 YAML/runtime）
```

Canvas Document 允许编辑器持有布局和展示信息；Canvas IR 只保留执行需要的图结构；现有 YAML 仍然是运行时兼容输出。

### 3.2 推荐结构

以下是设计级 TypeScript 形状，字段名在 Task 01 中冻结后再实现：

```ts
type CanvasExecutionProfile = 'lightweight-dag' | 'state-machine';

type CanvasNodeKind =
  | 'start'
  | 'agent'
  | 'script'
  | 'subworkflow'
  | 'branch'
  | 'join'
  | 'end';

interface WorkflowCanvasDocument {
  schemaVersion: 1;
  executionProfile: CanvasExecutionProfile;
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  groups?: WorkflowCanvasGroup[];
  metadata?: {
    title?: string;
    description?: string;
    viewport?: { x: number; y: number; zoom: number };
    updatedAt?: string;
  };
}

interface WorkflowCanvasNode {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  description?: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  executionRef?: { stateId?: string; stepId?: string };
  agent?: {
    name: string;
    model?: string;
    effort?: string;
    skills?: string[];
  };
  subworkflow?: {
    workflowRef: string;
    workflowMode: 'lightweight' | 'state-machine';
    version?: string;
    snapshotPolicy?: 'latest-compatible' | 'pin-version' | 'pin-content-hash';
    inputMapping?: Record<string, string>;
    outputMapping?: Record<string, string>;
    onFailure?: 'stop' | 'continue' | 'transition';
  };
  script?: {
    interpreter: string;
    command: string;
    workingDirectory?: string;
    timeoutSeconds?: number;
    onFailure?: 'stop' | 'continue' | 'transition';
  };
  branch?: { expression: string; outputNames: string[] };
  visual?: {
    category?: 'trigger' | 'agent' | 'integration' | 'review' | 'delivery';
    icon?: string;
    tags?: string[];
    collapsed?: boolean;
  };
}

interface WorkflowCanvasEdge {
  id: string;
  source: string;
  target: string;
  kind?: 'default' | 'success' | 'failure' | 'condition' | 'always';
  label?: string;
  condition?: string;
  order?: number;
}

interface WorkflowCanvasGroup {
  id: string;
  kind: 'state' | 'parallel';
  title: string;
  nodeIds: string[];
  stateRef?: string;
  reviewPolicy?: unknown;
  executionMode?: 'sequential' | 'parallel';
  position?: { x: number; y: number };
}
```

`visual.category` 只负责卡片风格和筛选，不改变执行语义。比如一个 Agent 可以被展示为“Review”，但运行时仍然是 Agent 步骤。

### 3.3 配置存储建议

现有 `workflow.mode` 保持不变：

- `lightweight`：用户看到的轻量工作流产品模式。
- `state-machine`：用户看到的状态机产品模式。

新增版本化的 `workflow.canvas` 编辑器字段。为了兼容当前 `workflow.profile: lightweight` 的严格校验，画布执行配置应使用独立的 `workflow.canvas.executionProfile`，不要直接重定义现有 `workflow.profile` 的含义：

```yaml
workflow:
  mode: lightweight
  profile: lightweight                 # 旧配置仍然有效
  canvas:
    schemaVersion: 1
    executionProfile: lightweight-dag
    nodes:
      - { id: start, kind: start, title: 开始, position: { x: 0, y: 0 } }
      - { id: end, kind: end, title: 完成, position: { x: 240, y: 0 } }
    edges:
      - { id: e1, source: start, target: end }
```

上例只展示配置外壳。可运行的首版轻量图在 Start 与 End 之间至少包含一个可执行节点。旧配置没有 `canvas` 时，读取适配器生成 Start → Agent → End 图。升级保存后，轻量图成为执行定义，运行前编译到现有执行设施。旧单步骤约束留在读取和迁移边界。校验、任务清单注入、启动、恢复及工作台可以重构。旧历史按原记录读取，升级前已启动的运行按原执行协议完成或恢复。状态机仍以既有状态、步骤和转移配置为执行定义，画布负责编辑投影及布局。

## 4. 轻量与状态机的映射关系

### 4.1 轻量旧配置到画布

```text
旧 lightweight state
  └─ 唯一步骤 Agent

转换为：
Start → Agent(tasklist skill) → End
```

旧状态的名称、描述和步骤任务分别作为图标题、Agent 节点说明和任务内容。`aceharness-tasklist` 保留为 Agent 节点的必需技能标签。

### 4.2 轻量新图到运行配置

第一阶段只允许以下约束：

- 恰好一个 Start 和一个 End。
- 所有节点可达。
- 图必须是一条顺序链，每个中间节点各有一条入边和出边。
- Agent 节点可配置不同 Agent。
- Script 节点复用现有脚本配置，但先按顺序执行。
- Subworkflow 节点可以引用一个轻量或状态机工作流，并作为一个有独立 run 边界的顺序节点执行。
- Branch、Join 和轻量图并发留待后续交付。

Subworkflow 的第一阶段约束：

- 父工作流只看到子工作流的输入、输出、状态和结果，不直接编辑子工作流内部节点。
- 子工作流按配置版本或内容 hash 固定快照，不能因为子工作流后来被编辑而改变已经启动的父 run。
- 父子之间通过显式 `inputMapping` 和 `outputMapping` 传值，不共享隐式上下文变量。
- 子工作流失败由节点自己的 `onFailure` 决定；不能把子工作流内部的失败步骤伪装成父图普通节点。
- 依赖图必须无环，并且运行时有最大嵌套深度，防止 A → B → A 或无限嵌套。

顺序图编译为一个执行计划，或者编译为一个内部的状态机快照。运行记录保存编译后的节点映射，原始画布后续修改不会影响当前运行。

### 4.3 状态机配置到画布

```text
State A ───────→ State B
  ├ Step A1       ├ Step B1
  ├ Step A2       └ Step B2
  └ Parallel Group
```

映射规则：

- 每个 state 映射为一个 `state` group。
- state 的 steps 映射为 group 内的 Agent、Script 或 Subworkflow 节点。
- state transition 映射为 group 之间的边。
- `reviewPolicy` 保存在 group 上，不下沉成普通 Agent 节点。
- `parallelGroup` 和 `concurrency` 映射为 group 内的并行泳道或并行容器。
- 状态的 initial/final 标志映射为 group 的入口/出口标记。

状态机内部的 Subworkflow 也保持为一个独立节点；如果它位于并行组中，仍由现有并行/并发规则调度，不在画布适配阶段展开其内部图。

状态机画布可以显示复杂信息，但不能把 group 展平后丢失状态级策略。

### 4.4 统一编译边界

编译器至少需要提供：

- `canvas -> lightweight execution plan`。
- `canvas -> state-machine config/snapshot`。
- `legacy lightweight config -> canvas`。
- `legacy state-machine config -> canvas`。
- `canvas validation`。
- Subworkflow 引用解析、版本/内容 hash 固定、输入输出映射和嵌套环检测。
- 节点 ID 与 state/step ID 的稳定映射。

编译失败必须返回节点级错误和边级错误，编辑器可以定位到具体卡片或连接线，不能只显示一个通用“配置无效”。

## 5. 画布编辑器设计

### 5.1 统一外壳

建议抽出 `WorkflowCanvasShell`，由轻量和状态机提供节点、边、检查器和能力开关：

- 顶部：名称、模式标签、保存状态、撤销/重做、校验、运行、导入导出。
- 中间左侧：React Flow 点阵画布。
- 中间右侧：节点/连接操作栈。
- 底部：缩放、适应画布、自动布局、帮助、节点和连接数量。
- 下方或右侧检查器：当前节点、边或状态 group 的属性。

### 5.2 轻量模式

默认显示：

- Agent。
- Script。
- Subworkflow（选择轻量或状态机工作流，并显示模式徽标）。
- Start / End。

隐藏或延后显示：

- 状态级审核策略。
- 状态级并发配置。
- 复杂转移脚本。

轻量模式仍可保留任务清单技能，但它是 Agent 节点能力，不再是整个工作流的拓扑模型。Subworkflow 节点只显示子工作流摘要、模式、版本和输入输出映射，不在当前画布中展开子图。

### 5.3 状态机模式

- 状态显示为可折叠 group/container。
- group 标题显示状态名称、审核策略和状态级错误。
- group 内展示步骤卡片。
- group 之间显示转移边。
- 并行步骤显示在 group 内的泳道或并行容器。
- 选中 group 时检查器显示状态属性；选中子节点时显示步骤属性。

### 5.4 组件适配原则

参考组件的 `initialGraph`、`apps`、`onChange` 和 `Connection stack` 思路，但适配成现有仓库的数据和组件：

- `initialGraph` 对应从配置适配出的 Canvas Document。
- `apps` 对应 Agent、脚本模板和未来的集成动作，不直接使用外部应用 logo URL。
- `onChange` 进入现有工作流配置保存/校验流程。
- 节点图标使用现有图标系统或本地资源。
- 样式使用现有 Tailwind/CSS token，避免组件内部大段独立 CSS 和 demo 状态。
- 继续使用现有 `reactflow` 版本、Provider 和事件模型。

## 6. Agent 市场仓库规范

Agent 市场的产品入口位于 Agent 页面，与本地 Agent 管理并列或使用页面内 Tab：

```text
Agent 页面
├─ 我的 Agent / 已安装
└─ Agent 市场
```

技能市场不增加 Agent 资源 Tab，也不把 Agent 搜索结果混入 Skill 搜索。市场 Provider、来源配置、下载校验、安装事务和回滚可以复用现有市场基础设施，但页面状态、文案、筛选和安装目标都属于 Agent 页面。

### 6.1 市场来源

现有市场来源配置扩展为可声明资源类型：

```ts
interface MarketplaceSourceConfig {
  id: string;
  label: string;
  protocol: 'matrix' | 'skillhub' | 'catalog' | 'git-repo';
  url: string;
  ref?: string;
  manifestPath?: string;
  resourceTypes: Array<'skill' | 'agent'>;
  builtin: boolean;
}
```

`git-repo` 首期支持公开 HTTPS 仓库，仓库地址、ref 和 manifest 路径由来源配置提供。私有仓库认证可以沿用市场来源凭据机制，但不把 token 写入 URL。

### 6.2 仓库目录和清单

仓库根目录默认包含 `aceharness-market.yaml`：

```yaml
kind: agent-market
schemaVersion: 1
name: example-agents
version: 1.0.0
description: Example Agent repository

agents:
  - id: compiler-reviewer
    path: agents/compiler-reviewer.yaml
    version: 1.2.0
    description: Review compiler issues and propose fixes.
    tags: [compiler, review]
    skills:
      - power-gitcode
```

Agent 文件使用现有 Agent Schema 支持的字段，例如 `name`、`team`、`roleType`、`engineModels`、`activeEngine`、提示词、能力、约束和技能引用。清单中的 `id` 是仓库内稳定身份；运行时 `name` 是本地 Agent 名称。

可选目录：

```text
aceharness-market.yaml
agents/*.yaml
skills/README.md       # 仅声明依赖，不自动覆盖本地 Skill
assets/                # 非可执行展示资源
```

### 6.3 安装和更新

安装流程：

1. 读取仓库清单并校验 schema/version。
2. 分页展示 Agent，显示版本、标签、依赖和来源。
3. 下载清单声明的文件，执行路径穿越、文件数量、文件大小和 YAML schema 校验。
4. 生成预览，标出本地同名 Agent、依赖 Skill 和可能的覆盖范围。
5. 写入临时目录，验证通过后原子替换。
6. 记录来源 URL、ref、commit hash、manifest hash、版本和安装时间。
7. 失败时恢复备份。

更新流程需要区分三类状态：

- 远端更新且本地未修改：允许一键更新。
- 远端更新且本地有修改：先显示 diff，再选择替换、保留本地或取消。
- 本地 Agent 未登记来源：视为本地配置，不能静默替换。

### 6.4 安全边界

- 只允许 HTTPS 来源。
- 默认不执行仓库脚本和 post-install hook。
- 禁止路径穿越和符号链接逃逸目标目录。
- 限制归档大小、文件数量和单文件大小。
- Agent YAML 必须通过现有 schema 和业务约束校验。
- Skill 依赖只做声明和显式安装，不自动覆盖用户已有技能。
- 记录 provenance，支持回滚和卸载保护。

### 6.5 Agent 页面 UI

Agent 页面保留现有本地 Agent 管理能力，并增加 Agent 市场 Tab 或二级视图：

- 本地 Agent：编辑、启用、删除、导入导出。
- Agent 市场：搜索、分页、来源筛选、预览、安装、更新、对比。
- 来源管理：在 Agent 市场上下文中管理 Agent 仓库来源；Skill 市场来源不自动出现在这里，除非来源明确声明支持 Agent。

Agent 卡片增加：版本、来源仓库、依赖、安装状态、更新状态、预览、安装、更新、对比。已安装 Agent 在本地列表显示“本地/市场来源/版本/可更新”信息。

## 7. Skill 转换与看板

### 7.1 aceharness-skill-to-workflow

在已安装 Skill 的详情提供“转换为工作流”，读取 SKILL.md 和用户选定的包内引用，进入现有创建流程并生成 Canvas Document 草案。可选的 `workflow` frontmatter 可声明输入、输出和验收要求。纯知识类 Skill 给出不适合转换的原因。正文推断逐项标记来源章节、推断或缺失，按可验收阶段划分 Agent、Script 或引用明确的子工作流节点。阶段内动态拆解仍由 Agent 节点的任务清单承担。首版生成顺序图，遇到无法表达的分支标记待补充。

草案展示节点、输入输出、依赖、脚本内容和待补充项。转换时只读取源材料，执行走确认保存后的正常运行入口。缺少必填配置的草案无法运行。生成结果走手工创建图的同一套校验和编译。

`workflow.canvas.source` 记录 Skill 稳定标识、可用的版本和来源、参与转换的文件及其内容摘要、转换协议版本。节点可记录来源文件及章节。打开或主动检查时比较摘要，显示来源变更或缺失，提供差异预览及重新生成草案。已有人工调整的工作流和运行快照保持原样。若运行仍依赖该 Skill，缺失或不兼容的依赖由运行前校验报告。

### 7.2 工作台看板

沿用现有看板入口，扩展 `LightweightTaskBoard` 和证据适配器，允许重构单步骤假设。运行画布按依赖展示节点，看板按状态展示同一批节点，点击时双向定位。手工创建和 Skill 生成的流程走同一条运行链路。

| 层级 | 卡片或详情 | 状态依据 |
| --- | --- | --- |
| 工作流节点 | Agent、脚本、子工作流，展示耗时、失败原因、日志和产物 | 编译快照的节点 ID 与持久化运行状态 |
| Agent 节点内部任务 | 展开任务、负责人、依赖及验收证据 | 对应节点和尝试下的任务清单及工具事件 |
| 脚本详情 | 退出状态、输出和产物引用 | 现有脚本执行结果 |
| 子工作流详情 | 子运行摘要及跳转 | 父节点记录的 childRunId 和结果 |

节点按 `runId + nodeId` 标识，`attemptId` 区分重试，任务再附加 `taskId`。共享投影先读带游标的持久化快照，再接续事件。重复事件去重，断线或出现事件缺口时重读快照。切换、重开或删除 run 时清理其作用域数据，忽略已离开 run 的迟到结果。待执行、进行中、阻塞、完成和失败由运行记录映射，取消和跳过保留明确标签。缺少证据显示未记录。节点和任务分别统计进度，子任务不重复计入节点完成度。首版看板只读，运行操作继续通过现有运行命令。

## 8. 校验和闭环

画布校验包括：

- 一个 Start、一个 End。
- 所有节点可达且没有悬空边。
- 轻量 DAG 无环。
- Join 的输入和输出完整。
- Agent 存在且可被工作流选择。
- Script 的解释器、命令、工作目录和失败策略完整。
- Subworkflow 引用存在、模式匹配、版本/快照可解析、输入输出映射完整，且依赖图无环并未超过嵌套深度。
- 节点输入引用已定义输出。
- 状态机 group 的 state 引用、转移目标、终态和审核策略合法。

运行前编译并保存执行快照；运行中只读取快照。编辑器报错要能定位节点、边、group 和字段路径。

## 9. 分阶段交付

1. 冻结 Canvas IR、存储字段、ID 策略和迁移规则。
2. 实现旧配置适配器和编译边界，但先保持现有运行行为。
3. 让轻量支持多 Agent 顺序图、Script 节点和顺序 Subworkflow 节点。
4. 让状态机映射到相同画布，并保留 group/并发/审核语义。
5. 建设共享 React Flow 画布和右侧检查器。
6. 建设公开 Git 仓库 Agent 市场的搜索、安装、更新和回滚。
7. 接入 Skill 转换草案、来源差异和工作台看板投影。
8. 验证配置迁移、嵌套执行、转换到看板、市场安装和回滚。

## 10. 主要风险

- 把轻量直接改成状态机 YAML 会让两种模式的边界消失；通过 Canvas IR 和编译边界隔离。
- 画布布局和运行配置混在一起会导致运行中被编辑影响；运行必须保存快照。
- Agent 市场直接覆盖本地 YAML 会损坏用户配置；必须使用 provenance、diff、备份和显式替换。
- 一开始就支持任意环路和并发会让执行语义无法验证；第一阶段限定 DAG 顺序执行。
- 直接复制参考组件会引入第二套 React Flow API；只迁移视觉和交互结构。
- 子工作流展开过早会造成图爆炸和运行边界丢失；第一阶段只显示为可配置节点，内部图在子工作流自己的编辑页查看。
