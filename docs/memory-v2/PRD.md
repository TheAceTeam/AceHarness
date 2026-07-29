# 分层短期与长期记忆 PRD

## 1. Feature Summary and Scope

- Feature name: 分层短期与长期记忆及步骤交接
- Feature ID: `MEM-V2`
- Status: draft
- Scope type: iteration
- Target user: 使用首页聊天、Agent Chat、阶段式工作流和状态机工作流的用户。
- Problem to solve: 现有聊天记忆、Agent 记忆、工作流经验、步骤输出和频道摘要各自独立，后续 Agent 常常需要重新读取全文或根本拿不到前序结论。
- Why this matters: 用户希望 AI 能自主沉淀有价值的信息，同时让后续步骤只读到必要摘要，并在需要时再读取具体详情。
- In scope:
  - 保留 `agent`、`workflow`、`project` 层级，并新增 `session`、`run`、`channel` 作用域；短期记忆有唯一 session 或 run 生命周期锚点。
  - 所有新产生的 V2 结构化记忆、频道交接、交接回执和审计数据统一保存到 SQLite；既有经验和 Agent relationship 文件不属于 V2 数据源。
  - 所有记忆统一采用 SQLite 一级索引和二级详情结构：一级只保存可检索摘要/读取条件/交接元数据，二级保存具体信息；默认只传一级索引。
  - AI 通过独立协议自主提出是否保存、短期/长期、作用域、交接方式、读取条件、摘要和具体信息。
  - 所有聊天和两类工作流使用统一的记忆查询与步骤交接机制。
  - 用受协议控制的摘要索引和按需详情读取，替代默认注入最近两个完成状态的原始输出。
  - 删除 Agent 管理页面中直接读取、编辑和清空记忆的 UI；旧记忆不迁移，V2 从空库开始，旧存储仅隔离归档且不删除。
- Out of scope:
  - 不把完整原始日志、命令回显或任意长步骤全文当作记忆正文注入 prompt。
  - 不在首期引入独立向量数据库或跨项目共享的无权限记忆。
  - 不导入、摘要、索引、回退读取或删除旧 `memory.sqlite`、旧角色/聊天/项目/工作流记忆、YAML experience、Agent relationship 文件、旧频道输出或历史 run 输出。

## 2. Main User Scenarios

### Scenario 1: AI 在执行后沉淀记忆

- Trigger: 一轮聊天、一个工作流步骤、人工答复或 Supervisor 复盘结束。
- User steps: 用户正常对话或运行工作流，无需手工选择存储位置。
- Expected result: AI 输出结构化记忆决策；系统把有效信息写入短期或长期 scope，并保存来源和审计记录。
- Storage result: 服务端在一次事务中写入索引、详情、scope 绑定和审计；保存响应不会把详情全文回传给后续 Agent 上下文。

### Scenario 2: 下一个 Agent 按需接力

- Trigger: 新步骤开始，或同一状态内切换到另一个 Agent。
- User steps: 用户继续工作流或恢复 run。
- Expected result: 无论下一步骤是否切换 Agent，当前 run 内所有已授权参与者共享同一短期记忆源；每个 Agent 只获得与当前目标匹配的摘要、读取条件、交接状态和记忆 ID。普通交接由 Agent 按需读取详情，必读交接在步骤实际工作前完成受控详情读取。

### Scenario 3: 工作流恢复

- Trigger: 服务重启、run resume、状态重试或子工作流结束。
- User steps: 用户点击恢复或继续运行。
- Expected result: 系统从 SQLite 重建 run 内短期交接上下文，不依赖进程内频道 Map 或最近两个输出文件。

### Scenario 4: Agent 管理页面不再手工维护记忆

- Trigger: 用户打开已有 Agent 的管理/编辑页面。
- User steps: 用户查看或修改 Agent 配置。
- Expected result: 页面不显示记忆正文、保存或清空控件；旧数据不删除但不会迁入或被 V2 使用。全局治理或审计只能在独立系统级表面管理 V2 新记录，不能在 Agent 页面直接修改记忆。

## 3. Rules and Edge Cases

| item | type: rule or edge case | description | expected behavior |
|---|---|---|---|
| 1 | rule | 短期与长期的含义 | 对话短期记忆只服务当前 `session`；工作流短期记忆服务一次完整 `run`，必须绑定唯一 `run + workflow` 生命周期锚点，不能缩小为单个步骤或创建它的 Agent。任何额外 project/agent/channel 绑定都不能让短期记录跨 session/run 命中。长期记忆跨对话/任务保存，必须至少绑定 `agent`、`workflow` 或 `project`。 |
| 2 | rule | 工作流短期记忆跨 Agent | 同一 run 内所有已授权工作流参与 Agent 都从同一短期记忆源查询；Agent 切换、状态切换和 resume 不会丢失它。交接目标只控制自动投递，不把记录变成源 Agent 私有数据。 |
| 3 | rule | 四项决策独立 | AI 必须分别决定 `retention`、scope、handoff 和 `readWhen`；长期不等于自动交接，短期也不等于必须读取。 |
| 4 | rule | AI 自主决策受服务端治理 | AI 提议 `discard/create/upsert/resolve`，服务端校验生命周期锚点、scope、跨 Agent 可见性、目标、去重、预期版本、权限、敏感信息和过期规则后落库。owner、workspace 和参与者权限只能由服务端从持久化 run/channel 成员快照派生。 |
| 5 | rule | SQLite 二级结构 | 每条记忆的索引与具体信息分别存入一级 `memory_items` 和二级 `memory_details`；默认读取不得 join 或传输二级详情。 |
| 6 | rule | 默认 prompt 只注入受预算索引 | 默认只注入匹配的 `summary/read_when/handoff/id` 索引，且所有序列化索引总字符数受服务器硬上限控制；`on-demand` 记录不进普通 manifest。 |
| 7 | rule | 保存与读取机制 | 保存由 AI 提议、服务端校验并原子写入索引/详情/绑定/交接控制面/审计；读取先查索引，再由显式 `memory.read` 按 ID、详情版本、权限和详情预算读取二级内容。 |
| 8 | rule | 必读交接 | 只有明确目标的 `required-read` 才会阻止目标步骤开始实际工作，直到它完成固定版本的必读 extract 并留下回执；必读索引超额、详情拒绝、超时、版本冲突或 extract 未读完均进入可见的 `handoff-blocked`，不能忽略。 |
| 9 | edge case | 已解决或被替代的信息 | 使用 `resolved/superseded/expired` 状态和关联关系更新，不无限追加重复记录；更新/解决必须携带目标 ID 或确认指纹和预期详情版本。 |
| 10 | edge case | runtime session 更换 | 新 runtime session 必须继续查询同一前端 session/run anchor，不能因压缩换 session 而丢失短期记忆，也不能借 relevance binding 读到其他短期边界。 |
| 11 | edge case | 权限和敏感内容 | 记录带服务端派生的 owner、workspace、参与者可见性；密钥、token、私钥、系统提示词和完整环境变量必须拒绝或脱敏。 |
| 12 | edge case | retry、频道与子工作流 | 每个步骤 attempt 有持久化 handoff batch、投递与回执。频道需 run/channel 成员授权；重试、取消、子工作流回传和 resume 必须重建状态，不能依赖进程内 Map。 |
| 13 | UI rule | Agent 管理页 | 删除直接记忆管理 UI，不能用新的手工编辑器替代；旧数据先隔离归档但不迁入 V2，UI 删除不依赖数据迁移。 |

## 4. Acceptance Criteria

| ac_id | scenario | expected result |
|---|---|---|
| AC-1 | 不同 Agent 串行步骤 | 后一步只看到前一步以 `manifest` 交接且目标匹配的摘要，不依赖复用同一个 runtime session。 |
| AC-2 | 必读交接 | 被 `required-read` 指定的目标步骤，在成功读取所需详情并留下审计确认前不能开始实际工作。 |
| AC-3 | 跨 Agent run 记忆 | 同一 run 内切换 Agent、跨状态继续或 resume 后，已授权 Agent 都能从同一短期 run 记忆源按目标、读取条件和生命周期重建有效的摘要、详情和来源。 |
| AC-4 | 短期生命周期 | 对话短期记忆在 session 边界内有效；工作流短期记忆在完整 run 内有效，run 结束后不进入下一个 run 的正常检索，也不会因额外绑定了 Agent、workflow 或 project 而变成长期保存。 |
| AC-5 | 二级存储 | 索引和详情在 SQLite 中一对一关联；默认 manifest、搜索结果和交接消息中不包含二级详情全文。 |
| AC-6 | 索引总字数 | 每次 manifest 和搜索结果实际传给 AI 的索引总字符数均不超过服务器配置的硬上限；普通溢出有受限省略计数，必读溢出显式失败。 |
| AC-7 | 长期记忆隔离 | agent、workflow、project 作用域独立，不能跨项目或跨用户误命中。 |
| AC-8 | AI 写入 | 每条持久化记录可追溯到 AI、消息、步骤、run 或人工答复，并有摘要、读取条件、详情和交接决策。 |
| AC-9 | Agent 管理 UI | Agent 编辑页面不展示记忆正文或保存/清空操作；旧数据不删除但不通过 V2 查询。 |
| AC-10 | Fresh Start | `memory-v2.sqlite` 首启没有旧 memory items/details/handoffs；旧 SQLite/YAML/文件的 hash 保持不变，V2 的 prompt、搜索、详情、治理和 fallback 路径均零访问旧内容。 |
| AC-11 | 投递与回执 | 每个步骤 attempt（含 no-op、重试、取消和子工作流回传）都有可恢复的交接状态；必读回执与详情版本绑定，失败进入可操作的阻塞状态。 |
| AC-12 | 授权与隔离 | 不同 session/run anchor、未授权 workflow participant、未授权 channel member、跨用户或跨项目都不能读取对应索引或详情。 |

## 5. Open Questions and Notes

### Open questions

- 长期记忆默认应采用 `review` 还是 `auto` 治理策略？该产品决策必须在 Task 2 启用任何长期自动写入前锁定；无论选择哪种模式，系统级 review 队列都必须提供审计化 approve/reject/expire/supersede/reclassify 动作。
- run 或对话终态后的短期记录的物理清理/审计窗口由何种保留策略控制？它们无论保留多久都不得进入新的 run 或对话的正常检索。
- 原始运行产物是否也必须迁入 SQLite？设计建议是不迁入，只在记忆记录中保存证据引用。

### Assumptions

- 首期使用 SQLite FTS5 做关键词检索和排序，不依赖独立向量数据库。
- 结构化记忆详情保存在 `memory_details` 的 SQLite TEXT/JSON 字段；原始 artifacts 继续在 run 输出目录保存，并由类型化、路径校验的 SQLite artifact reference 关联。

### Notes

- 技术设计、fresh-start 隔离边界和实施任务见 [README.md](README.md)、[Design Locks](00-design-locks.md) 与 [记忆决策与步骤交接协议](memory-decision-and-handoff-protocol.md)。

### Raw PM wording

- 长期记忆和短期记忆需要区分；agent、workflow、项目等多层级概念继续保留。
- AI 自主决定记忆存储方式和内容；记忆要有摘要、何时读取和具体信息。
- 最近两个完成状态的输出应改为由独立交接协议决定的概要和按需读取详情机制；业务问题等级只是可选业务标签，不能充当通用记忆规则。
- 短期记忆指本次对话或一次完整工作流运行内的信息；工作流短期记忆跨参与 Agent 共享。长期记忆指跨任务、长期保存的信息。
- 所有记忆使用 SQLite 索引/详情二级结构，默认只传受总字数限制的索引；详情按 ID 和权限按需读取。
- Agent 管理页面的记忆管理 UI 直接删除；旧记忆不迁移，Memory V2 从空库开始，旧存储只读归档且不进入 V2。
