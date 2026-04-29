## ACEHarness Spec Coding（aceharness-spec-coding 技能）

**触发场景：**
- 用户要求 spec-first、先写规范再实现、把粗需求变成可执行计划
- 用户提到 proposal、design、tasks、变更规范、正式规范制品
- 用户要求创建 workflow 前先澄清需求、沉淀需求、生成正式计划制品
- 用户要求根据规范执行任务、更新任务状态或把实现反馈同步回规范

**核心定位：**
- ACEHarness Spec Coding 是 skill 名称；正式制品使用 `specs/` + `changes/` 结构
- 正式制品是规范源；运行态结构只作为 UI、prompt、进度和 revision timeline 的投影/快照
- 涉及 runtime/API contract、阶段名或协议标签迁移时，必须保留旧会话、旧配置和旧 agent 输出的兼容路径

**核心规则：**
- 使用 `<root>/specs/<domain>/spec.md` 和 `<root>/changes/<change-id>/...` 结构
- `spec.md` 只写行为契约和场景，不写实现细节
- `proposal.md` 写意图、范围、事实、假设和非目标
- `design.md` 写技术方案、数据流、伪代码、接口契约、关键决策、风险和兼容策略
- `tasks.md` 写可执行清单，每个任务必须包含目标、输入/依赖、关联需求、关联设计、任务类型、具体改动对象、执行动作、交付产物、验证方式和完成标准
- 只要本次输出创建、修改或落盘了正式规范制品，最终结果就必须通过 `node skills/aceharness-spec-coding/scripts/validate-spec-coding.mjs <spec-root>`
- 禁止空泛表述：不要写“优化体验”“完善能力”“支持功能”“完成对接”“处理细节”这类无对象、无条件、无结果的句子
- 多份制品必须语言一致、术语一致、范围一致；文件名、代码、YAML key、API 名称和技术专名可以保留原文

**需求访谈规则：**
在写 proposal/design/tasks/spec 之前，先从上下文推断已知事实，再只问会改变计划的问题。不要问代码或用户输入已经回答过的问题。

优先补齐这些维度：
1. 目标与用户价值：谁需要这个变化，成功后用户或系统能观察到什么结果
2. 当前行为与目标行为：现在如何运行，目标如何变化，哪些旧行为必须保持
3. 范围与非目标：本次包含/排除哪些入口、角色、数据、文件、API、UI 或 workflow 阶段
4. 输入、输出与状态：请求参数、配置、存储字段、UI 状态、文件产物或流式输出如何变化
5. 兼容与迁移：旧会话、旧配置、旧 API、历史数据或已生成 workflow 是否继续可用
6. 失败与边界：空输入、权限不足、解析失败、模型输出不合规、超时或外部依赖失败时怎么处理
7. 安全与隐私：是否涉及凭据、用户数据、命令执行、文件读写或权限边界
8. 性能与可靠性：是否影响长任务、并发、构建、大文件、流式输出或重试
9. 验证与发布：使用哪些测试命令、人工验收场景、日志或替代证据证明完成

问题质量规则：
- 区分 blocking questions 和 optional refinements。blocking 不清楚会改变实现或验收；optional 只影响偏好或增强。
- 问题必须指向具体决策：范围、兼容、数据模型、UI 行为、权限、验证或迁移。
- 优先给 2 到 4 个具体选项，并保留 Other/自由文本路径。
- 如果用户跳过问题，给出保守假设，并在 `clarification.missingFields` 中保留风险。
- 不要问“还要优化什么体验”“是否需要完善功能”这种无法直接落到任务的泛化问题。

**Context snapshot：**
正式制品前必须先整理：
- 用户目标和原始诉求
- 已确认事实及证据来源（用户输入、已读代码、现有规范、错误日志、运行数据）
- 当前假设
- 待确认问题
- 影响面：页面、组件、API、状态字段、存储键、脚本、提示词、workflow 配置、测试入口
- 约束：权限、安全、平台、兼容、语言一致性、不能变更的 runtime/API contract

**Plan-mode 质量模型：**
- 先做 context snapshot，再 solutioning
- 明确 requirements 和 non-goals；排除范围不能在 tasks 里偷偷实现
- 区分 facts / assumptions / open questions；没有证据的内容不能写成结论
- 执行前设置 approval gate：正式制品或关键方案变更需要用户、Supervisor 或 owner 确认
- 任务要表达依赖、状态和 ownership；需要时写 blocked by、owner、权限边界、阻塞条件和解除条件
- 验证要有 acceptance evidence：命令、测试、人工验收记录或替代证据

**质量门槛：**
- `requirements/design/tasks` 必须形成追踪链：需求编号 -> 设计决策/组件 -> 任务编号 -> 验证
- `proposal.md` 必须能回答“为什么现在要做、影响谁、影响哪些入口、不做什么”
- `design.md` 必须能回答“当前怎么运行、要改哪几层、数据和状态怎么流动、失败时怎么处理”
- `design.md` 缺少 Mermaid 图、架构/数据流图、伪代码、关键数据模型、接口契约任一关键骨架时，都视为未达标
- `design.md` 的 `Key Decisions` 至少要有 3 条，且每条都要包含“选择 / 原因 / 替代方案为何不选 / 风险”
- `tasks.md` 必须能回答“先做什么、改哪里、怎么验、做完产出什么、剩余风险是什么”
- `tasks.md` 不得执行 requirements/spec 未承诺的内容
- `tasks.md` 每个阶段至少包含实现任务、验证任务、异常/兼容任务；涉及 UI 或运行态状态时，还要有显示层、提示词或文档同步任务
- 输出前做一致性自检：检查 proposal、design、tasks、spec 是否冲突、越界、遗漏或把假设写成事实

**执行循环：**
1. 确定 `<root>`、`<domain>`、`<change-id>`
2. 读主规范 `specs/<domain>/spec.md`
3. 读 change 制品：`proposal.md`、`design.md`、`tasks.md`、增量 `spec.md`
4. 补齐 blocking 需求问题；如用户跳过，写明保守假设和风险
5. 从 `tasks.md` 选择最小未完成任务
6. 按 spec 边界实现并验证
7. 更新 `tasks.md` 状态
8. 必要时更新增量 spec、design 或 proposal
9. change 稳定后再合并回主规范

**校验：**
仅在当前任务明确要求创建、更新或校验正式规范制品时使用该脚本。workflow 草案生成阶段不要自行校验 workflow/YAML，不要调用 `validateWorkflowDraft`、`config.validate` 或类似本地校验脚本；平台会在 AI 输出 workflow_draft 后自动解析和校验。

```bash
node skills/aceharness-spec-coding/scripts/validate-spec-coding.mjs <spec-root>
```

**与 workflow 创建协同：**
1. 先用本 skill 生成并确认正式规范制品
2. 再由 workflow creator 基于确认后的 spec 设计 workflow 草案
3. workflow 草案阶段不要重新澄清需求、不要重新生成 spec、不要把已确认制品再次作为输出目标
4. 运行态结构只作为 spec 的结构化投影
