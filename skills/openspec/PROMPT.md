## OpenSpec（openspec 技能）

**触发场景：**
- 用户要求按 OpenSpec 写规范、先写 spec 再实现
- 用户提到 spec-first、proposal、design、tasks、变更规范
- 用户要求根据 OpenSpec 执行任务、更新任务状态或沉淀需求
- 用户要求把设计文档、对话需求或 workflow 创建流程转成正式规范

**核心规则：**
- 使用 `<root>/specs/<domain>/spec.md` 和 `<root>/changes/<change-id>/...` 结构
- `specs/` 是单一事实来源，`changes/` 是提议中的修改
- `spec.md` 只写行为契约和场景，不写实现细节
- `proposal.md` 写意图和范围，`design.md` 写技术方案，`tasks.md` 写实施清单
- `proposal/design/tasks/spec` 都要足够细，能直接支撑实现和人工审查
- 只要本次输出创建、修改或落盘了正式 OpenSpec 制品，最终结果就必须通过 `node skills/openspec/scripts/validate-openspec.mjs <openspec-root>`；未通过校验视为结果不合格
- 禁止空泛表述：不要写“优化体验”“完善能力”“支持功能”“完成对接”“处理细节”这类无对象、无条件、无结果的句子；每条都必须落到具体对象、入口、状态、数据或约束
- 先定义术语，再展开需求；当领域内存在多个专有名词、角色、模块或数据对象时，必须先写术语表
- 需求优先采用固定 DSL：`Requirement / 目标用户与诉求 / 验收标准`
- 每条需求都必须可编号、可引用、可验证，不能写成自由散文
- `验收标准` 优先使用半结构化句式：`当 <条件> 时，系统应 <行为/结果>`
- `design.md` 必须包含流程图或 Mermaid 图，以及贴近真实业务规则的伪代码 / 结构化算法
- `design.md` 不能只有概念说明；至少要同时给出执行链路图和能落到真实分支判断的伪代码
- `design.md` 还应包含架构分层、核心组件、关键数据模型、接口/契约、关键决策、假设与待确认项
- `design.md` 不接受“组件 A 负责处理请求、组件 B 负责渲染页面”这类无信息密度描述；必须点名真实入口、真实状态来源、真实副作用、真实失败路径
- `design.md` 中的图不能只是装饰。图里至少要体现入口、核心处理节点、状态/数据更新、对外结果或持久化副作用
- `tasks.md` 必须按阶段细拆任务，并写清楚目标、依赖、产物、验证方式和完成标准
- `tasks.md` 必须尽量回链需求编号，并显式区分实现、验证、迁移、文档等任务类型
- `tasks.md` 中每个任务都必须是“一个人拿到就能直接开做”的粒度；禁止出现“完善设计”“补齐逻辑”“联调验证”“实现全部前端/后端”这种打包任务
- `tasks.md` 中每个任务都要写明改动对象，例如页面、组件、接口、存储、提示词、状态字段、脚本、校验规则、测试入口；不能只写抽象能力
- `tasks.md` 中每个任务都必须使用固定字段展开；只写一行任务标题或一句话描述视为不合格
- 需求、设计、任务三份文档必须互相一致；如果存在假设、未验证信息或技术选项分歧，必须显式写出，不能伪装成既定事实
- 正式计划文档本身不直接写 workflow、agent、状态机等系统术语，但结构必须足够清晰，以便后续派生 workflow 和角色分工
- 增量规范放在 `changes/<change-id>/specs/<domain>/spec.md`
- 正式 OpenSpec 制品是规范源；运行态 `OpenSpecDocument` 只是投影/快照
- 普通 agent 只能更新任务进度；Supervisor / owner 可以修订任务内容、设计、范围和规范行为
- 优先使用 `skills/openspec/templates/` 模板，不依赖仓库其他文档示例

**质量门槛：**
- `requirements/design/tasks` 必须形成追踪链：需求编号 -> 设计决策/组件 -> 任务编号 -> 验证
- `design.md` 中的关键结论必须能追溯到已知事实、用户输入或显式假设
- `design.md` 缺少 Mermaid 图、架构/数据流图、伪代码、关键数据模型、接口契约任一关键骨架时，都视为未达标
- `tasks.md` 不得执行 `requirements/spec` 未承诺的内容
- `proposal.md` 必须能回答“为什么现在要做、影响谁、影响哪些入口、不做什么”
- `design.md` 必须能回答“当前怎么运行、要改哪几层、数据和状态怎么流动、失败时怎么处理”
- `tasks.md` 必须能回答“先做什么、改哪里、怎么验、做完产出什么、剩余风险是什么”
- `tasks.md` 的每个任务至少要包含：`目标 / 输入或依赖 / 具体改动对象 / 执行动作 / 交付产物 / 验证方式 / 完成标准`
- 如果信息不足，先明确“已确认事实 / 当前假设 / 待确认问题”，再给出当前最佳草案
- 输出前做一次一致性自检：检查需求、设计、任务之间是否存在冲突、越界或遗漏

**细化要求：**
- 能引用真实对象时，优先引用真实对象：模块名、页面名、API 路径、状态字段、存储键、配置项、文档制品、校验脚本、测试入口
- 不能确认真实对象时，必须写成“待确认项”或“当前假设”，不要用模板化虚词糊过去
- `proposal.md` 至少要拆出 2 到 4 个业务切片，每个切片都能继续映射到设计章节和任务阶段
- `design.md` 的 `Key Decisions` 至少要有 3 条，且每条都要包含“选择 / 原因 / 替代方案为何不选 / 风险”
- `tasks.md` 每个阶段至少包含：实现任务、验证任务、异常/兼容任务；如果涉及 UI 或运行态状态，还要有文档/提示词/显示层同步任务

**执行循环：**
1. 确定 `<root>`、`<domain>`、`<change-id>`
2. 读主规范 `specs/<domain>/spec.md`
3. 读 change 制品：`proposal.md`、`design.md`、`tasks.md`、增量 `spec.md`
4. 从 `tasks.md` 选择最小未完成任务
5. 按 spec 边界实现并验证
6. 更新 `tasks.md` 状态
7. 必要时更新增量 spec、design 或 proposal
8. change 稳定后再合并回主规范

**校验：**
仅在当前任务明确要求创建、更新或校验 OpenSpec 文件时使用该脚本。只要本次任务产出了或修改了正式 OpenSpec 制品，就必须通过该校验。workflow 草案生成阶段不要自行校验 workflow/YAML，不要调用 `validateWorkflowDraft`、`config.validate` 或类似本地校验脚本；平台会在 AI 输出 workflow_draft 后自动解析和校验。
```bash
node skills/openspec/scripts/validate-openspec.mjs <openspec-root>
```

**与 workflow 创建协同：**
1. 先用本 skill 生成并确认 OpenSpec 制品
2. 再由 workflow creator 基于确认后的 spec 设计 workflow 草案
3. 运行态对象只作为 spec 的结构化投影
