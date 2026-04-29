---
name: aceharness-spec-coding
description: ACEHarness Spec Coding skill for spec-first planning and implementation. Use this whenever the user asks for spec-first coding, workflow planning, requirements clarification, proposal/design/tasks artifacts, implementation-ready specs, compatibility-aware changes, or turning rough requirements into executable plans. It creates and maintains specs/changes artifacts, asks targeted requirement questions before solutioning, preserves facts/assumptions/open questions, and treats runtime projections as generated views of the formal artifacts.
descriptionZH: ACEHarness Spec Coding 规范编码技能。【触发场景】spec-first、先写规范再实现、需求澄清、workflow 规划、proposal/design/tasks、变更规范、把粗需求沉淀为可执行计划、按规范执行任务或更新任务状态。使用 specs/ 与 changes/ 结构；正式制品是规范源，运行态结构只是投影/快照。
tags:
  - ACEHarness Spec Coding
  - Spec
  - Proposal
  - Design
  - Tasks
---

# ACEHarness Spec Coding

本 skill 用于把粗糙需求转成可审查、可实现、可验证的正式规范制品，并在实现阶段按规范推进。面向项目和用户的 skill 名称是 `aceharness-spec-coding`，制品采用 `specs/` + `changes/` 结构。

目标质量基线：

- 需求文档不是总结，而是可编号、可验收、可引用的需求 DSL。
- 设计文档不是汇报，而是能指导真实实现的技术方案。
- 任务文档不是 TODO 列表，而是带追踪链、验证方式、交付产物和完成标准的执行清单。
- `proposal.md`、`design.md`、`tasks.md`、`spec.md` 必须术语一致、范围一致、语言一致。
- 低质量但“看起来完整”的空话文档视为不合格，尤其是泛化任务、套话式设计、无法落地的验收标准。
- 只要当前任务创建、更新或落盘正式规范制品，最终必须通过 `node skills/aceharness-spec-coding/scripts/validate-spec-coding.mjs <spec-root>`。

## 工作方式

### 1. 先做需求访谈，再写方案

不要在信息不足时直接生成一套看似完整的计划。先从已有上下文推断，再只问会改变实现和验收的关键问题。

需求访谈至少覆盖这些维度：

- 目标与用户价值：谁需要这个变化，成功后可观察结果是什么。
- 当前行为与目标行为：现在怎么运行，期望改成什么，哪些旧行为必须保留。
- 范围与非目标：本次包含哪些入口、角色、数据和场景；明确不做什么。
- 输入、输出与状态：用户输入、API payload、存储字段、UI 状态、文件或配置如何变化。
- 兼容与迁移：旧数据、旧配置、旧 workflow、旧会话是否要继续可读。
- 失败与边界：空数据、权限不足、超时、解析失败、模型输出不合规时怎么处理。
- 安全与隐私：是否接触凭据、用户数据、文件系统、命令执行或权限边界。
- 性能与可靠性：是否影响长任务、流式输出、构建、并发或大文件。
- 验证与发布：用哪些命令、测试、人工验收或日志作为 acceptance evidence。

提问规则：

- 先吸收用户已经说过的内容和代码中能确认的事实，不重复提问。
- 只问会影响实现策略、验收标准、兼容策略、任务拆分或验证方式的问题。
- 把问题分成 blocking 与 optional：blocking 不清楚就会改变计划；optional 只是偏好或增强。
- 优先给具体选项并允许用户补充 Other；避免“你还有什么要求？”这种空泛问题。
- 每个问题都说明它会影响哪类决策，例如范围、数据模型、迁移、UI 行为、验证策略。

高质量问题示例：

- “历史 workflow 草案阶段名是否必须继续被旧会话识别？这会决定我们是直接改标识还是新增显示别名。”
- “创建工作流时，如果用户跳过澄清问题，系统应采用保守默认假设继续生成草案，还是阻止进入下一步？这会影响计划阶段的错误处理和 UI 状态。”

低质量问题示例：

- “你想优化哪些体验？”
- “需要完善哪些功能？”
- “是否需要联调验证？”

### 2. Context snapshot

写正式制品前先整理上下文快照：

- 用户目标和原始诉求。
- 已确认事实：来自用户输入、已读代码、现有规范、运行数据或错误信息。
- 当前假设：合理但尚未被证据确认的判断。
- 待确认问题：会影响范围、兼容、实现或验收的问题。
- 影响面：页面、组件、API、存储、状态字段、脚本、提示词、workflow 配置、测试入口。
- 约束：权限、安全、平台、兼容、语言一致性、不能改动的 runtime/API contract。

没有证据的内容不能写成结论；必须标成“当前假设”或“待确认项”。

### 3. Requirement / non-goal extraction

正式需求必须可编号、可引用、可验证。推荐结构：

- Requirement：稳定编号和清晰行为。
- 目标用户与诉求：谁在什么场景需要它。
- 验收标准：优先使用“当 <条件> 时，系统应 <结果>”。
- 非目标：明确排除范围，后续 tasks 不得绕开实现。

## 目录结构

默认根目录由用户或当前任务指定。没有约定时，可使用仓库根下的 `spec-coding/` 作为制品根；这是规范制品目录名，不是 skill 名称。

```text
<spec-root>/
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

- `specs/` 是单一事实来源，描述当前已经承诺的行为。
- `changes/` 是提议中的修改；每个 change 是一个自包含文件夹。
- `changes/<id>/specs/<domain>/spec.md` 是增量规范，描述相对当前主规范的新增、修改或删除。
- change 完成并稳定后，增量规范应合并回 `specs/<domain>/spec.md`。

## 一套 Spec，两种载体

在本项目里可能存在运行态结构化投影。它不是另一套规范源，而是正式规范制品的快照或索引。

- 正式制品：`proposal.md`、`design.md`、`tasks.md`、`specs/.../spec.md`，是规范源。
- 运行态对象：用于 UI 展示、prompt 注入、进度追踪、revision timeline。
- 普通 agent 只能更新任务状态、进度说明或完成结果。
- Supervisor / owner 可以修订任务内容、设计、范围和规范行为，并必须留下 revision summary。
- 涉及 runtime/API 字段、阶段名或协议标签重命名时，必须同时考虑旧会话、旧数据和旧 agent 输出的兼容别名。

## 命名规则

- `domain` 使用稳定业务领域名，短横线英文或稳定系统名，例如 `auth`、`workflow-runtime`、`homepage-sidebar`。
- `change-id` 使用短横线英文，例如 `add-dark-mode`、`workflow-spec-confirmation`。
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

避免写入内部类名、函数名、框架选择、逐步实施清单或详细技术方案。

### `proposal.md`

说明为什么做、做什么、不做什么，以及高层方法。必须回答：

- 为什么现在要做。
- 影响谁、影响哪些入口、影响哪些数据或状态。
- Includes / Excludes 的边界。
- 成功结果和失败后果。
- 当前事实、假设和待确认项。

### `design.md`

说明技术路径、数据流、关键决策、受影响区域、迁移和风险。必须包含：

- Overview、Technical Approach、Architecture、Data Flow。
- 至少两张独立 `mermaid` 代码块图，用于表达架构/执行链路和数据流。
- Core Logic Pseudocode 下的伪代码代码块。
- Data Models、Interfaces And Contracts、Assumptions And Unknowns。
- 至少 3 条 `### Decision:`，每条包含选择、原因、替代方案为何不选、风险。
- Affected Areas、Risks And Tradeoffs。

设计必须点名真实入口、真实状态来源、真实副作用、真实失败路径；不能只有“组件 A 处理、组件 B 展示”的抽象描述。

### `tasks.md`

任务要按阶段分组，使用 `1.1`、`1.2` 编号。每个任务必须使用固定字段：

- 目标
- 输入/依赖
- 关联需求
- 关联设计
- 任务类型
- 具体改动对象
- 执行动作
- 交付产物
- 验证方式
- 完成标准

任务拆分规则：

- 一个任务应小到一个执行者拿到就能直接开做。
- 每个任务必须点名真实改动对象：页面、组件、API、状态字段、存储键、schema、配置项、提示词、脚本、测试入口或文档制品。
- 每个阶段至少能看出实现、验证、异常/兼容/迁移处理；涉及 UI 或运行态状态时，要单独覆盖显示层或提示词同步。
- 禁止“实现功能 / 完善逻辑 / 联调验证 / 优化体验”这类无对象、无条件、无结果的任务。

### `changes/<id>/specs/<domain>/spec.md`

增量规范使用 `## 新增需求`、`## 修改需求`、`## 删除需求` 分组。每个需求仍然必须包含场景。

## 工作流

### 创建或更新规范制品

1. 确定根目录、`domain`、`change-id`。
2. 读取现有 `specs/<domain>/spec.md`，明确当前行为。
3. 按需求访谈规则补齐 blocking 信息。
4. 使用 `skills/aceharness-spec-coding/templates/` 中的模板，不要从仓库其他历史文档复制样例。
5. 创建或更新：`proposal.md`、`design.md`、`tasks.md`、增量 `spec.md`。
6. 做一致性自检：需求是否可验证、设计是否覆盖关键需求、任务是否追溯到需求和设计、假设是否被误写成事实。
7. 如果落盘了正式制品，运行校验脚本。

### 根据规范执行任务

1. 读主规范和 change 制品。
2. 从 `tasks.md` 选择最小未完成任务。
3. 按规范边界实现，不做超范围行为。
4. 验证实现并保留 acceptance evidence。
5. 更新 `tasks.md` 进度。
6. 如行为变化，更新增量 spec；如技术方案变化，更新 design；如范围变化，更新 proposal。
7. change 稳定后，再把最终行为合并回主规范。

### 与 workflow 创建协作

当用户要创建 workflow 且要求 spec-first：

1. 先用本 skill 生成并确认正式规范制品。
2. 等用户确认或修订 spec。
3. 再由平台内建 workflow 创建机制基于已确认 spec 生成 workflow 草案。
4. workflow 派生应主要读取 proposal 的目标/范围、design 的链路/组件/接口、tasks 的阶段切片/依赖/验证节点。
5. 正式计划文档本身不需要直接出现 workflow 或 agent 术语，但结构必须能支持后续派生。

## 更新规则

| 变化类型 | 更新位置 |
|---|---|
| 新增或调整目标、范围、非目标 | `proposal.md` |
| 技术方案、数据流、模块边界变化 | `design.md` |
| 完成或推进具体工作 | `tasks.md` |
| 外部可观察行为变化 | `changes/<id>/specs/<domain>/spec.md` |
| change 已稳定成为当前事实 | `specs/<domain>/spec.md` |

## 模板

模板位于：

- `skills/aceharness-spec-coding/templates/spec.md`
- `skills/aceharness-spec-coding/templates/proposal.md`
- `skills/aceharness-spec-coding/templates/design.md`
- `skills/aceharness-spec-coding/templates/tasks.md`
- `skills/aceharness-spec-coding/templates/delta-spec.md`

## 校验

仅在当前任务明确要求创建、更新或校验正式制品时使用该脚本。workflow 草案生成阶段不要自行校验 workflow/YAML，不要调用 `validateWorkflowDraft`、`config.validate` 或类似本地校验脚本；平台会在 AI 输出 workflow_draft 后自动解析和校验。

```bash
node skills/aceharness-spec-coding/scripts/validate-spec-coding.mjs <spec-root>
```

校验脚本会检查：

- `specs/` 和 `changes/` 是否存在。
- 主规范是否包含目的、需求、场景。
- change 是否包含 proposal、design、tasks、增量 spec。
- design 是否包含图、伪代码、关键决策，并且没有未替换占位符。
- tasks 是否包含足够任务、展开说明和固定字段。
- 增量 spec 引用的 domain 是否存在主规范。

## 常见错误

- 只写总结，没有 `需求:` 和 `场景:`。
- 没有先问清 blocking requirement，就直接编造计划。
- 把“推测/候选方案”写成“已确认事实”。
- 把实现计划写进 `spec.md`。
- `proposal.md` 只有目标，没有范围边界、用户场景和不做项。
- `design.md` 只有空泛架构图，没有真实状态流、失败路径和兼容策略。
- `tasks.md` 写成抽象 TODO，没有具体改动对象、交付产物、验证方式和完成标准。
- 实现完成后不更新任务状态。
- 行为变化后不更新增量 spec。
- 把运行态结构化投影当作规范源。
