# 记忆决策与步骤交接协议

Updated: 2026-07-24

本协议是 Memory V2 中所有聊天、工作流步骤、频道和子工作流共同使用的契约。它把“是否保存”“保存多久”“与哪些层级相关”“是否交给后续步骤”“何时必须或可以读取”拆成独立决策，避免用单一问题等级代替真实语义。

## 1. 不可替代的四项决策

| 决策 | 值 | 回答的问题 | 与其他决策的关系 |
|---|---|---|---|
| `retention` | `none`、`short`、`long` | 这条信息是否保存，以及保存的生命周期是什么？ | 不决定是否主动交接。 |
| `scopeBindings` | `agent`、`workflow`、`project`、`session`、`run`、`channel` 的一个或多个绑定 | 这条信息在哪些上下文中相关、可见？ | 不决定保存长短；工作流 `run` 绑定默认跨参与 Agent。 |
| `handoff` | `none`、`manifest`、`on-demand`、`required-read` 加目标选择器 | 哪些后续步骤或 Agent 应获得这条信息？ | 不改变其保存层级。 |
| `readWhen` | 触发条件和匹配规则 | 到达目标时，AI 何时应考虑、查询或必须读取它？ | 只控制检索资格和时机。 |

任何一次 AI 记忆决策都必须明确这四项，或明确选择 `retention: none`。服务端不能从业务问题等级、输出长度或最近时间自行推断长期保存或强制交接。

## 2. 生命周期定义

- `none`：没有可复用价值，不建立 `memory_items` 记录，也不能创建后续步骤交接。服务端仍可记录不含详情的审计决策。
- `short`：只服务于当前对话或一次完整工作流运行。每条短期记录必须有且仅有一个不可变 `lifecycleAnchor`：对话短期记忆锚定 `sessionId`，工作流短期记忆锚定 `runId + workflowId`，而不是某个状态、步骤或创建它的 Agent。工作流短期记录必须以 `workflow-participant` 可见。对话或 run 终态后，它立即退出正常记忆检索；物理清理可保留受配置控制的审计/恢复窗口，但不得让它对新的对话或 run 重新可见，也不得默认变成长期保存。
- `long`：跨对话或跨任务长期保存的可复用信息。它必须至少绑定一个持久层级 `agent`、`workflow` 或 `project`；`session`、`run` 只能作为来源信息，不能作为唯一长期相关范围。长期记忆默认不因对话或 run 结束而过期，只能由明确的过期策略、解决、替代或治理操作结束。

选择指南：当前对话的上下文、一次完整工作流 run 的决策和未完成事项、临时约束通常为 `short`；经过确认、可复用且能在未来任务中帮助判断的规范、经验、稳定偏好和项目知识通常为 `long`；既不需要复用也不需要交接的内容为 `none`。

## 3. 协议数据形状

以下是协议形状，不是最终 TypeScript API 名称。所有字段由服务端 schema 校验、归一化和权限控制。

```ts
type ScopeBinding = {
  scopeType: 'agent' | 'workflow' | 'project' | 'session' | 'run' | 'channel';
  scopeKey: string;
  role: 'lifecycle-anchor' | 'relevance';
};

type MemoryDecision = {
  action: 'discard' | 'create' | 'upsert' | 'resolve';
  retention: 'none' | 'short' | 'long';
  lifecycleAnchor?:
    | { scopeType: 'session'; sessionId: string }
    | { scopeType: 'run'; runId: string; workflowId: string };
  scopeBindings: ScopeBinding[];
  summary: string;
  readWhen: {
    text: string;
    triggers: Array<'conversation-turn' | 'task-start' | 'step-start' | 'workflow-resume' | 'explicit-search'>;
    workflowStates?: string[];
    stepIds?: string[];
    stepTags?: string[];
    agentIds?: string[];
    keywords?: string[];
  };
  handoff: {
    mode: 'none' | 'manifest' | 'on-demand' | 'required-read';
    target: 'none' | 'next-step' | 'matching-steps' | 'named-agents';
    stepIds?: string[];
    stepTags?: string[];
    workflowStates?: string[];
    agentIds?: string[];
  };
  details: string;
  kind: string;
  confidence: number;
  sourceEventId: string;
  idempotencyKey: string;
  targetMemoryId?: string;
  expectedDetailVersion?: number;
  expectedFingerprint?: string;
  expiresAt?: string;
  replacesMemoryId?: string;
};
```

逻辑上的每条记忆必须包含用户要求的三个内容字段，但它们不能放在同一个默认查询层：

- `summary`：可放入有严格预算的 manifest 的简短概要。
- `read_when` / `readWhen`：说明 AI 应在什么情境下读取的文本和受限结构化条件。
- `details`：完整但有大小上限的具体信息、结论、验证状态和 artifact 引用；存入二级详情行，默认不进入 prompt。

`retention: none` 时，`scopeBindings` 必须为空、`lifecycleAnchor` 不存在、`handoff.mode` 和 `handoff.target` 必须为 `none`，且 `details` 不得持久化。对话 `short` 必须有唯一 `session` anchor；工作流 `short` 必须有唯一 `run + workflow` anchor 和 `workflow-participant` 可见性。短期记录的所有普通检索先按 anchor 精确等值过滤，随后才考虑 relevance binding；relevance binding 绝不能让另一 session 或 run 命中该记录。一个短期记录不得同时绑定多个 session 或多个 run。工作流短期记录的创建 Agent 只记录在来源字段，不能作为可见性或读取范围的唯一限制。`channel` binding 必须同时带同一 `run` anchor。`long` 必须携带 `agent`、`workflow` 或 `project` 绑定。`required-read` 只能指向可解析的具体目标，不能写成对所有未来步骤永久生效的规则。

`create` 必须带新的 `sourceEventId + idempotencyKey`；`upsert` 和 `resolve` 必须带 `targetMemoryId`，或带可由服务端确认的 `expectedFingerprint`，并同时带 `expectedDetailVersion`。版本或指纹不匹配时服务端返回冲突而非覆盖较新详情；`replacesMemoryId` 只能用于已验证的替代关系，不能充当更新目标。

### 3.1 工作流 run 的跨 Agent 约束

- 同一个 run 内，任何被授权执行该工作流步骤的 Agent 都是工作流短期记忆的潜在消费者，不依赖创建记录的 Agent、runtime session 或状态机状态。
- `handoff.target` 只决定谁会自动收到摘要和谁可能被要求必读；它不能把记录改成源 Agent 私有信息。`named-agents` 是有意缩小自动投递范围的例外，必须带理由和审计。
- 切换 Agent、串行步骤、状态切换、暂停/恢复、子工作流回到父工作流时，都从同一 `run` 绑定和 SQLite 交接索引恢复上下文。
- 一次 run 结束后，其短期记录不参与下一个 run 的普通检索。若某个结论应跨 run 保存，AI 必须单独提议 `long` 记录并通过治理校验。

### 3.2 授权来源

- AI 只能提议 scope 与 handoff 语义，不能提交或扩大 `owner_user_id`、workspace、参与者或可见性名单。服务端从 run 创建者、workspace 权限和持久化的 workflow participant snapshot 派生这些字段。
- `run_participants` 记录 run 创建时的参与 Agent、所属用户/workspace、版本和授权状态；运行中新增、撤销或替换参与者必须写入版本化成员事件。resume 使用持久化快照和后续成员事件，不从当前内存 Agent 列表猜测权限。
- `channel` 还必须由 `run_channel_members` 的持久化成员快照校验。不同用户共享项目时，`owner`、workspace 访问权、run participant 和 channel membership 全部为 AND 条件，任何一个不满足都拒绝索引和详情读取。

## 4. SQLite 二级存储与索引预算

所有 Memory V2 记忆，不论属于 `agent`、`workflow`、`project`、`session`、`run`，也不论是短期、长期、频道或步骤交接，都使用同一 SQLite 二级结构。YAML、进程内 Map、prompt 文本和原始输出文件都不能成为另一套记忆正文存储。

| 层 | 存储 | 内容 | 默认可传给 AI |
|---|---|---|---|
| 一级索引 | `memory_items`、`memory_scope_bindings`、`memory_links` | `memoryId`、retention、状态、不可变 lifecycle anchor、scope、`summary`、`read_when`、handoff、置信度、轻量来源、详情版本和已计算的索引字符数 | 是，但必须通过目标、权限、`readWhen` 和总字符预算。 |
| 二级详情 | `memory_details`，每个 `memoryId` 一对一版本化详情行 | `details`、详情字符数、内容哈希、格式和 artifact 引用 | 否；仅 `memory.read` 或 `required-read` 预检成功后按详情预算返回。 |
| 交接控制面 | `memory_handoff_batches`、`memory_handoffs`、`memory_handoff_receipts` | 每次步骤的 no-op/已发出/失败结果、投递目标、memory/detail revision、必读状态和回执 | 仅以受预算的索引和必读 ID 形式暴露。 |

- `memory_items` 不得保存或复制 `details` 正文；`memory_fts` 只允许保存由 `summary`、`read_when` 和受限关键词生成的有界 `search_projection`，不得把原始详情全文复制进索引。
- 写入时，服务端必须在同一事务中写入索引行、详情行、scope 绑定、交接索引、受限 FTS 投影和审计。任一环节失败则整体回滚；同一 `sourceEventId` 重试必须幂等。
- Memory V2 首启为空库：既有聊天、角色、项目、工作流、频道和 YAML 经验记忆不导入、不生成索引、不参与默认或显式读取。旧存储仅作为不被 V2 查询的归档保留；不得把旧全文塞进 `summary`、`read_when` 或 FTS 投影来伪装成新记忆。
- `memory_handoff_batches` 以 `runId + sourceStepAttemptId` 幂等，记录显式 no-op、emitted、failed、cancelled 或 superseded。`memory_handoffs` 记录每条 memory 的 mode、目标选择器和已解析目标、`detailVersion`、父/子 run 来源。`memory_handoff_receipts` 以 `handoffId + targetStepAttemptId + detailVersion` 幂等，记录 pending、read、acknowledged、failed、cancelled、retrying 以及失败码。
- Artifact 不是 memory link 的伪装字段。`memory_artifact_refs` 必须使用类型化 `runId`、artifact kind、受校验的相对路径、内容哈希、生成时间和可选 `memoryId + detailVersion` 关联；路径不得逃出所属 run 输出目录。

### 4.1 索引字符预算

索引是默认交给 AI 的唯一记忆载体。服务端必须对实际序列化后的每个索引和整个 payload 同时限额：

- `maxIndexItemChars`：单个索引中 `memoryId`、`summary`、`read_when`、handoff 标记和轻量来源合计的最大字符数。
- `maxManifestChars`：一次步骤/对话 prompt 中所有记忆索引序列化后的总字符数上限；模型、调用方和单个工作流都不能提高服务器硬上限。
- `maxSearchIndexChars`：一次 `memory.search` 返回的索引总字符数上限，使用相同计数方法。
- `maxRequiredReadIndexChars`：从 `maxManifestChars` 中预留给 `required-read` ID 和摘要的固定份额，确保必读交接不会被普通候选项挤掉。

构造 manifest 时，服务端以 `required-read` 控制面、目标精确度、读取条件匹配、置信度、任务/FTS 匹配、创建时间和 `memoryId` 的稳定顺序排序，再只加入完整、未超出预算的索引。普通 `manifest` 项超额时丢弃较低排序项，并仅返回受限的省略计数，不截断或泄露详情。`required-read` ID 和摘要使用预留控制面预算且仍计入 `maxManifestChars`；若无法完全放入，步骤必须在预检阶段失败并要求上游合并、解决或重写交接；不得静默跳过必读项。

`memory.read` 有独立 `maxDetailReadChars`。详情超额时返回版本固定、可审计的分页/游标块，而不是隐式截断；`required-read` 必须在写入时生成一个不超过该限制的必读 extract，并以 `memoryId + detailVersion + extractHash` 固定回执对象。权限拒绝、版本冲突、脱敏后为空、超时、artifact 不可用或分页未读完都将 receipt 标为 `failed`，目标步骤进入 `handoff-blocked`，只能 retry、由 Supervisor/人工重分类或 fail-step，不能继续执行。

## 5. 交接模式和目标

| `handoff.mode` | 目标行为 | 详情行为 |
|---|---|---|
| `none` | 不主动交给后续步骤；符合 `readWhen` 时仍可通过普通检索找到。 | 仅显式搜索后读取。 |
| `manifest` | 目标步骤得到 `memoryId`、`summary`、`read_when` 和轻量来源。 | Agent 自行调用 `memory.read`，详情不默认注入。 |
| `on-demand` | 不进入常规步骤 manifest，只在 Agent 的显式搜索或精确 ID 查询中返回。 | 显式读取。 |
| `required-read` | 目标步骤在开始实际工作前收到必读 ID 列表。运行时要求成功读取并记录确认后才能继续该步骤。 | 通过受预算的 `memory.read` 返回，不把原始步骤全文直接拼入 prompt。 |

`target` 决定投递范围：

- `next-step`：由编排器在记录创建时解析为当前 run 的下一个可执行串行步骤，无论该步骤是否切换到另一个 Agent，避免重试或工作流图变更时误投递。
- `matching-steps`：仅投递给同时满足 `stepIds`、`stepTags`、`workflowStates` 等选择器的步骤。
- `named-agents`：仅自动投递给指定 `agentIds`，并仍受当前 run、项目和可见性校验；它不把 run 记忆的来源 Agent 变成唯一读者。
- `none`：只能与 `handoff.mode: none` 组合使用。

每次完成步骤必须创建一个 `memory_handoff_batch`，即使是 no-op。目标解析在 source step attempt 完成时冻结；重试创建新的 target step attempt receipt，不覆盖已有回执。子工作流完成时以父 run/父 step 作为显式目标写入新的 handoff batch，不能复用子 run 的内存对象。

短期记忆和长期记忆都可以使用任意合法交接模式。例如，长期项目规范通常是 `long + none/on-demand`，当前 run 中必须处理的交接事项通常是 `short + manifest/required-read`。保存时间不推导投递方式。

## 6. 保存、读取与执行顺序

1. 每个聊天回合或步骤结束时，AI 通过 `memory.propose` 对候选信息给出一个或多个 `MemoryDecision`，或显式返回 `discard` / 无操作。提议中的 `details` 只从 AI 到服务端，不会被回显进后续默认上下文。
2. 服务端验证 lifecycle anchor、scope 所有权、participant snapshot、跨 Agent run 可见性、敏感信息、索引和详情预算、重复指纹、预期版本、替代关系、过期时间和目标选择器；服务端生成/校验受限索引后，原子写入一级索引、二级详情、绑定、交接控制面和审计记录。
3. 后续对话或步骤开始时，`buildManifest` 只查询一级索引，先对短期记录做 lifecycle anchor 等值过滤，再过滤 owner、成员权限、scope、目标和 `readWhen`，最后稳定排序并应用总字符预算。不同 Agent 在同一授权 run 中从同一 run-wide 索引源查询。
4. `memory.search` 也只返回受预算的索引。Agent 仅在确有需要时调用 `memory.read(memoryId, detailVersion, cursor?)`；服务端重新校验权限、成员快照、scope、handoff 目标、详情版本和详情字符预算后，才从二级详情表读取内容并写入审计。`on-demand` 只在显式搜索出现。
5. `required-read` 在步骤实际工作前读取固定 extract 并写入 versioned receipt；索引预算溢出、详情读取失败或确认缺失都必须令步骤进入 `handoff-blocked`，不能以原始输出尾部兜底。
6. 解析、重试、resume 和子工作流返回均从 SQLite 重建交接索引。原始输出只作为 artifact 证据，不能替代该协议。

## 7. 工作流输出与频道

每个完成的工作流步骤都必须产生一个结构化交接结果：要么包含已验证的 `MemoryDecision` 引用，要么显式声明没有需要保存或交接的信息。运行时可为非 `none` 交接创建短期 `run` 交接索引，但不会复制或把所有原始输出变成记忆详情。

频道消息使用 `run + channel` 的短期 binding 和相同协议，`channel` 是受 `run_channel_members` 授权的显式 scope，而不是拼接进自由文本 scope key。`channelOutputsById` 不参与 V2 正确性路径，恢复 run 时只能查询 SQLite。

## 8. 业务标签的边界

`P0`、`P1`、`P2` 或任何其他问题优先级/严重度标签可以作为某个工作流自己的可选业务元数据，用于该工作流展示或排序；它们不是 Memory V2 的字段语义，不能决定 `retention`、`handoff`、`readWhen`、默认注入或详情读取权限。

## 9. 典型决策示例

| 情况 | retention | scope | handoff | readWhen |
|---|---|---|---|---|
| 当前对话已确认但尚未执行的操作 | `short` | 当前 `session`，由对话参与者共享 | `none` | 后续对话回合、明确搜索该操作时 |
| 某一步完成后下一串行步骤必须采用的接口决定 | `short` | 当前完整 `run`、`workflow`，所有工作流参与 Agent 可读 | `required-read + next-step` | 目标步骤启动时，即使下一个步骤切换 Agent |
| 已验证、跨未来任务可复用的项目约定 | `long` | `project`，可附加 `workflow` | `on-demand` | 新任务涉及对应标签或关键词时 |
| 只对本步输出有意义的推理草稿 | `none` | 无 | `none` | 无 |

## 10. 实施与验证要求

- 所有 Memory V2 writer 和 reader 必须使用本协议；不得保留按原始输出尾部、固定最近状态数或业务等级隐式传递上下文的旁路。
- 测试必须覆盖四项决策彼此独立的组合：长期但不交接、短期但必读、可搜索但不进 manifest、无保存且无交接。
- 测试必须证明默认 manifest 和 `memory.search` 不读取或传输二级详情，且序列化后的索引总字符数永不超过服务器预算；必读索引超额必须失败而不能静默丢弃。
- 测试必须覆盖 lifecycle anchor 负例、participant/channel 授权、no-op/重试/取消/子工作流 handoff batch、版本化 receipt、详情分页/失败状态、类型化 artifact 引用，以及“旧记忆既不导入也不在任何 V2 读取路径出现”的 fresh-start 隔离。
- UI 不向 Agent 管理页暴露直接编辑、清空或手工注入记忆的入口。治理、审计和待审提议使用独立的系统级表面，且不改变协议的服务端校验。
