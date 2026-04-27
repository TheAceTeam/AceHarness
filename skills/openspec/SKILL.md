---
name: openspec
description: 使用 OpenSpec 风格创建、维护和执行 specs/changes 制品。触发场景：用户提到 OpenSpec、spec-first、proposal/design/tasks、变更规范、先写 spec 再实现、把需求沉淀为规范、按规范执行任务或更新任务状态。必须产出 proposal.md、design.md、tasks.md、specs/<domain>/spec.md 等正式 OpenSpec 制品，并把运行态对象视为正式 OpenSpec 的投影。
descriptionZH: OpenSpec 规范技能。【触发场景】OpenSpec、spec、proposal、design、tasks、变更规范、spec-first、先写规范再实现、按规范执行任务、更新任务状态。使用 specs/ 与 changes/ 结构；正式 OpenSpec 制品是规范源，运行态 OpenSpecDocument 只是投影/快照。
tags:
  - OpenSpec
  - Spec
  - Proposal
  - Design
  - Tasks
---

# OpenSpec

本 skill 用于创建、维护和执行 OpenSpec 风格的规范制品。目标是让不了解 OpenSpec 的 agent 也能稳定产出合法的 `specs/` 与 `changes/` 结构，并能根据 `tasks.md` 执行和更新进度。

本 skill 的目标质量参考接近 `.kiro/specs` 中的高质量规格：

- 需求文档不是总结，而是可编号、可验收、可引用的需求 DSL
- 设计文档不是汇报，而是可指导实现的技术方案
- 任务文档不是 TODO 列表，而是带追踪链和验证方式的执行清单
- 三份文档必须前后自洽，不能互相打架
- 多份制品必须使用统一语言：优先使用用户需求正文的主语言；文件名、代码、API、YAML key 和技术专名可以保留原文，但不要在 `proposal.md`、`design.md`、`tasks.md`、`spec.md` 之间混用中文和英文说明。
- 低质量但“看起来完整”的空话文档视为不合格，尤其是泛化任务、套话式设计、无法落地的验收标准

## 核心原则

OpenSpec 的工作方式：

- 灵活而非僵化：按工作需要创建或更新制品，不强制阶段门。
- 迭代而非瀑布：需求和设计可以随着代码理解加深而修订。
- 简单而非复杂：使用轻量 Markdown 制品，不引入多余仪式。
- 棕地优先：优先描述对现有系统行为的增量变化。

## 体系结构

OpenSpec 根目录由用户或当前任务约定指定。没有约定时，可使用仓库根下的 `openspec/`。

```text
<openspec-root>/
├── specs/
│   └── <domain>/
│       └── spec.md
└── changes/
    └── <change-id>/
        ├── proposal.md
        ├── design.md
        ├── tasks.md
        └── specs/
            └── <domain>/
                └── spec.md
```

- `specs/` 是单一事实来源，描述系统当前已经承诺的行为。
- `changes/` 是提议中的修改；每个 change 是一个自包含文件夹。
- `changes/<id>/specs/<domain>/spec.md` 是增量规范，描述相对当前主规范的新增、修改或删除。
- change 完成并稳定后，增量规范应合并回 `specs/<domain>/spec.md`。

## 一套 Spec，两种载体

在本项目里可能存在运行态 `OpenSpecDocument`。它不是另一套规范源，而是正式 OpenSpec 制品的结构化投影/快照。

- 正式 OpenSpec 制品：`proposal.md`、`design.md`、`tasks.md`、`specs/.../spec.md`，是规范源。
- 运行态对象：用于 UI 展示、prompt 注入、进度追踪、revision timeline。
- 普通 agent 只能更新任务状态、进度说明或完成结果。
- Supervisor / owner 可以修订任务内容、设计、范围和规范行为，并必须留下 revision summary。

## 命名规则

- `domain` 使用稳定业务领域名，短横线英文或稳定系统名，例如 `auth`、`workflow-runtime`、`homepage-sidebar`。
- `change-id` 使用短横线英文，例如 `add-dark-mode`、`workflow-openspec-confirmation`。
- 不要用临时任务标题、中文句子、日期戳作为默认 `domain` 或 `change-id`。

## 制品职责

### `specs/<domain>/spec.md`

主规范只写当前稳定行为。它是行为契约，不是实施计划。

必须包含：

- `# <领域名>规范`
- `## 目的`
- `## 术语表`（当领域术语较多时为必需项）
- `## 需求`
- 至少一个 `### 需求:...`
- 每个需求至少一个 `#### 场景:...`

推荐写法：

- 先冻结术语，再写需求，避免后文反复换称呼
- 每条需求都能被编号和引用
- 场景优先使用“当 <条件> 时，系统应 <结果>”的可验证句式

好的内容：

- 用户或下游系统依赖的可观察行为
- 输入、输出、错误和权限条件
- 安全、隐私、可靠性、兼容性约束
- 可测试或可人工验收的场景

避免写入：

- 内部类名、函数名、文件名
- 框架或库选择
- 逐步实施清单
- 详细技术方案

### `proposal.md`

说明为什么做、做什么、不做什么，以及高层方法。范围变化、意图变化、方法根本变化时更新它。

要求：

- 明确业务问题、业务对象、影响面和不处理的边界
- 验收标准必须可验证，不能只写“体验更好”“结构更清晰”这类抽象表述
- 如果用户需求本身偏粗，先把需求拆成可执行子问题，再落到 proposal
- 尽量为后续设计和任务提供“需求切片”，让后续阶段容易派生执行顺序和协作边界
- 不能只写“支持 X、优化 Y、增强 Z”，必须说明入口、对象、触发条件、成功结果、失败后果

### `design.md`

说明技术路径、数据流、关键决策、受影响区域、迁移和风险。实现发现方案不可行、依赖变化、架构决策变化时更新它。

要求：

- 必须包含流程图，优先 Mermaid
- 必须包含伪代码、规则表或步骤化算法，能直接指导实现
- 必须包含核心组件、关键数据模型、接口/契约或输入输出结构
- 必须显式区分“已确认事实”“当前假设”“待确认问题”
- 关键决策必须说明为什么这样设计，以及替代方案为什么不选
- 所有设计都要回扣真实业务对象、输入输出、边界条件和兼容策略
- 必须尽量引用真实代码边界、真实状态字段、真实入口或真实文档制品；如果尚未确认，显式标成待确认
- 不接受只有分层图没有执行链路的设计；必须能看出谁触发、谁处理、谁落库、谁展示、谁验证

### `tasks.md`

可执行清单。任务要按阶段分组，使用 `1.1`、`1.2` 这种分层编号。完成任务后更新勾选状态；不能完成时保留未勾选并写明阻塞。

要求：

- 任务必须细到能直接执行，不接受“完成设计”“实现功能”这类空泛条目
- 每个任务都要写清楚目标、输入或依赖、执行动作、交付产物、验证方式和完成标准
- 任务拆分应覆盖正常路径、边界路径、失败路径、兼容处理和验证收口
- 尽量标注关联需求编号、关联设计章节、任务类型与依赖顺序，形成稳定追踪链
- 文档表面保持业务化，但结构要足够稳定，以便后续从任务阶段与能力切片派生 workflow 和角色分工
- 每个任务都必须指向至少一个真实改动对象，例如具体页面、组件、接口、配置项、状态字段、脚本、测试文件、文档制品
- 每个阶段至少要能看出“实现什么、验证什么、兼容什么、还要同步什么”
- 如果任务描述删掉具体名词后仍然成立，说明它太空，需要继续细化
- 每个任务都必须使用固定字段展开，不能只保留一行标题或一句话说明

### `changes/<id>/specs/<domain>/spec.md`

增量规范。使用 `## 新增需求`、`## 修改需求`、`## 删除需求` 分组。每个需求仍然必须包含场景。

## 工作流

### 创建或更新 OpenSpec

1. 确定根目录、`domain`、`change-id`。
2. 读取现有 `specs/<domain>/spec.md`，明确当前行为。
3. 创建或更新 change 文件夹：
   - `proposal.md`
   - `design.md`
   - `tasks.md`
   - `specs/<domain>/spec.md`
4. 使用 `skills/openspec/templates/` 中的模板，不要从仓库其他文档复制历史样例。
5. 先完成一次一致性自检：
   - 需求是否都可验证
   - 设计是否覆盖每类关键需求
   - 任务是否能追溯到需求和设计
   - 是否把假设误写成事实
6. 如果当前任务是在文件系统中创建或更新 OpenSpec 制品，运行校验脚本。

### 根据 OpenSpec 执行任务

1. 读主规范：`specs/<domain>/spec.md`。
2. 读变更制品：`proposal.md`、`design.md`、`tasks.md`、增量 `spec.md`。
3. 从 `tasks.md` 选择一个最小未完成任务。
4. 按规范边界实现，不做超范围行为。
5. 验证实现。
6. 更新 `tasks.md` 进度。
7. 如行为变化，更新增量 spec；如技术方案变化，更新 design；如范围变化，更新 proposal。
8. change 稳定后，再把最终行为合并回主规范。

### 与 workflow 创建协作

当用户要创建 workflow 且要求 OpenSpec/spec-first：

1. 先用本 skill 产出正式 OpenSpec 制品。
2. 等用户确认或修订 spec。
3. 再由平台内建的 workflow 创建机制基于已确认 spec 生成 workflow 草案。
4. workflow 派生应主要读取：
   - `proposal.md` 中的业务目标、范围、验收边界
   - `design.md` 中的主链路、关键组件、输入输出和实现阶段
   - `tasks.md` 中的阶段切片、依赖顺序、验证节点和能力边界
5. spec 文档本身不需要直接出现 workflow 或 agent 术语，但其结构必须能稳定支持派生。
6. 运行态 `OpenSpecDocument` 只作为已确认 spec 的投影/快照。

## 更新规则

| 变化类型 | 更新位置 |
|---|---|
| 新增或调整目标、范围、非目标 | `proposal.md` |
| 技术方案、数据流、模块边界变化 | `design.md` |
| 完成或推进具体工作 | `tasks.md` |
| 外部可观察行为变化 | `changes/<id>/specs/<domain>/spec.md` |
| change 已稳定成为当前事实 | `specs/<domain>/spec.md` |

权限规则：

- 普通 agent：只能更新 `tasks.md` 中的进度、勾选状态、阻塞说明、验证结果。
- Supervisor / owner：可以修订任务内容、范围、设计、规范行为和分工。
- 任何结构性修订都要留下 revision summary 或在任务说明中写明影响范围。

## 模板

模板位于：

- `skills/openspec/templates/spec.md`
- `skills/openspec/templates/proposal.md`
- `skills/openspec/templates/design.md`
- `skills/openspec/templates/tasks.md`
- `skills/openspec/templates/delta-spec.md`

使用方式：

- 创建主规范时使用 `spec.md`。
- 创建 change 时使用 `proposal.md`、`design.md`、`tasks.md`、`delta-spec.md`。
- 保留模板中的章节结构，替换占位符。
- 删除与本次无关的示例条目，但不要删除必需章节。

## 校验

仅在当前任务明确要求创建、更新或校验 OpenSpec 文件时使用该脚本。workflow 草案生成阶段不要自行校验 workflow/YAML，不要调用 `validateWorkflowDraft`、`config.validate` 或类似本地校验脚本；平台会在 AI 输出 workflow_draft 后自动解析和校验。

运行：

```bash
node skills/openspec/scripts/validate-openspec.mjs <openspec-root>
```

校验脚本会检查：

- `specs/` 和 `changes/` 是否存在
- 主规范是否包含目的、需求、场景
- change 是否包含 proposal、design、tasks、增量 spec
- 增量 spec 引用的 domain 是否存在主规范

## 常见错误

- 只写一个总结，没有 `需求:` 和 `场景:`。
- 没有术语表，导致同一对象在不同文档中反复换叫法。
- 需求、设计、任务之间互相矛盾。
- 把“推测/候选方案”写成“已确认事实”。
- 把实现计划写进 `spec.md`。
- 只写 `tasks.md`，没有 proposal/design/增量 spec。
- `tasks.md` 写成抽象 TODO，没有前置条件、交付产物、验证方式和具体改动对象。
- `tasks.md` 的任务只有一句话，没有固定字段结构。
- `design.md` 只有空泛架构图，没有真实状态流、失败路径和兼容策略。
- `proposal.md` 只有目标，没有范围边界、用户场景和不做项。
- 实现完成后不更新任务状态。
- 行为变化后不更新增量 spec。
- 把运行态 `OpenSpecDocument` 当作规范源。
- 把所有内容塞进一个 Markdown 文件，而不是使用 `specs/` + `changes/` 结构。
