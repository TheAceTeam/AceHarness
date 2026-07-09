# ACEHarness Runtime-first Agent Runtime 重构方案

## 设计基准

本方案以破坏性重构为前提，不以保留旧 wrapper/driver 形态为目标。最终目标是把 ACEHarness 的 AI 执行层从“Engine wrapper 集合”重构为统一的 Agent Runtime 平台。

核心判断：

- `Engine`、`EngineOptions`、`EngineStreamEvent`、`engine-factory`、`sdk/stdio driver` 都是旧架构概念，应从新核心设计中废弃。
- acpx 是主要 runtime adapter，不是 ACEHarness 的平台抽象本身。
- `cangjie-magic` 作为长期一等 runtime 时，也实现 ACEHarness 自己的 `RuntimeAdapter`，而不是模仿 acpx API。
- SQLite 是 runtime、session、models、probe、benchmark、trace 的 source of truth。
- YAML 只作为 seed、preset、导入导出格式，不参与运行时读写。
- 旧配置和旧数据只做一次性 migration，不保留长期兼容路径。
- 权限默认最大开放，即默认不限制。用户可显式收紧到安全策略。

## 总目标

1. 废弃旧 `Engine/wrapper/driver` 体系，建立 Runtime-first 架构。
2. 除 `cangjie-magic` 外，所有 agent 通过 acpx 接入。
3. `cangjie-magic` 通过 `MagicAdapter` 接入同一 runtime contract。
4. 删除所有 SDK driver 和 stdio wrapper 分叉，不再维护同一工具的两套驱动。
5. 建立平台级 runtime session graph，统一 chat、agent chat、workflow、probe、diagnostics。
6. 建立 SQLite-first 模型路由系统，执行时使用 `modelRouteId`。
7. 建立结构化 runtime event / trace，过程块只是 UI projection。
8. 建立 agent registry，统一 agent 元数据、命令、能力、模型 schema、环境变量 schema、图标。
9. 建立 secret/env profile，支持 agent auth、MCP env ref、连接测试和日志脱敏。
10. 支持队列、取消、打断输入、compact、fork、诊断包导出。

## 非目标

1. 不再把 acpx “塞进”现有 `Engine` 接口。
2. 不在运行时支持 `sdk`、`stdio`、`driver`、`drivers`。
3. 不在新 API 中暴露 `backendSessionId`、`acpxRecordId`、provider native id。
4. 不在运行时兼容旧 `ModelOption`、`activeEngine`、`engineModels`、`defaultModel`。
5. 不使用 emoji 或纯文字作为 agent 图标兜底。

## 目标架构

```text
Chat / Workflow / Agent Chat / Probe / Diagnostics
  -> RuntimeOrchestrator
    -> ProfileResolver
    -> AgentRegistry
    -> ModelRoutingService
    -> SecretEnvService
    -> PermissionService
    -> RuntimeSessionStore
    -> RuntimeTurnStore
    -> RuntimeEventStore
    -> RuntimeTraceStore
    -> SessionGraphService
    -> RuntimeAdapterRegistry
      -> AcpxAdapter
      -> MagicAdapter
    -> EventProjection
      -> ChatProjection
      -> WorkflowProjection
      -> ProcessBlockProjection
```

### 新核心边界

```ts
interface RuntimeOrchestrator {
  openSession(input: OpenRuntimeSessionInput): Promise<RuntimeSessionRef>;
  runTurn(input: RunRuntimeTurnInput): AsyncIterable<RuntimeEvent>;
  cancelTurn(input: CancelTurnInput): Promise<void>;
  getSessionStatus(input: SessionStatusInput): Promise<RuntimeSessionStatus>;
  compactSession(input: CompactSessionInput): Promise<CompactResult>;
  forkSession(input: ForkSessionInput): Promise<ForkResult>;
}

interface RuntimeAdapter {
  createOrLoadSession(input: AdapterSessionInput): Promise<RuntimeBinding>;
  runTurn(binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AdapterRuntimeEvent>;
  cancel(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void>;
  invokeCommand?(binding: RuntimeBinding, input: AdapterCommandInput): AsyncIterable<AdapterRuntimeEvent>;
  compact?(binding: RuntimeBinding, input: AdapterCompactInput): Promise<AdapterSessionHandoff>;
  fork?(binding: RuntimeBinding, input: AdapterForkInput): Promise<AdapterSessionHandoff>;
  handoff?(input: AdapterHandoffInput): Promise<RuntimeBinding>;
  close(binding: RuntimeBinding): Promise<void>;
  getCapabilities(input: AdapterCapabilitiesInput): Promise<RuntimeCapabilities>;
  getStatus(binding: RuntimeBinding): Promise<AdapterRuntimeStatus>;
}
```

职责切分：

- `RuntimeOrchestrator`：唯一业务入口，负责事务、队列、session、turn、event、权限、compact、fork。
- `RuntimeAdapter`：只负责和具体 runtime 通信。acpx 和 Magic 都实现它；optional method 只表达 runtime 原生能力，不允许业务层绕过 orchestrator 直接调用。
- `AgentRegistry`：agent 元数据唯一来源。
- `ModelRoutingService`：模型路线解析，不归属 acpx。
- `EventProjection`：把 canonical runtime events 投影到 chat、workflow、ACE process blocks。

## 废弃对象

这些对象不进入新核心设计：

- `Engine`
- `EngineOptions`
- `EngineStreamEvent`
- `EngineResult`
- `engine-factory`
- `engine-selection` 中的 driver 映射
- `acp-engine`
- `acp-wrapper-base`
- `CodexEngineWrapper`
- `ClaudeCodeEngineWrapper`
- `ClaudeCodeAcpEngineWrapper`
- `OpenCodeEngineWrapper`
- `OpenCodeSdkEngineWrapper`
- `NgaEngineWrapper`
- `NgaSdkEngineWrapper`
- `CodegenieEngineWrapper`
- `CodegenieSdkEngineWrapper`
- `CursorEngineWrapper`
- `KiroCliEngineWrapper`
- `TraeCliEngineWrapper`
- `MagicCliEngineWrapper` 旧 wrapper 形态

允许存在一个极薄 legacy shim，仅用于迁移尚未改完的调用点；shim 不应成为新 API 或新测试的目标。shim 只能 import 新 runtime facade，禁止新 runtime 反向 import shim。Phase 5 完成后 shim 必须删除，并在 lint/check 脚本中禁止新增旧接口引用。

## Agent Registry

Agent registry 是 agent 定义源，不是所有运行时状态的唯一真相。SQLite 仍是运行时 source of truth：

- Registry 保存内置 agent 定义、默认 command resolver、默认 env schema、默认 capability schema、默认图标。
- SQLite 保存用户覆盖、availability 结果、env readiness、discovery cache、capability probe、agent 启用状态。
- Orchestrator 读取时合成 `AgentDefinition + AgentRuntimeState`，不允许 UI/API 直接硬编码 agent 能力。

Agent registry 的落库边界：

- 内置定义仍在代码/JSON registry 中，版本随应用发布。
- 用户 override、启用/隐藏状态、最后一次 availability、env readiness、capability probe 结果必须写 SQLite。
- `/api/agents` 返回合成结果，字段来源要可追踪：`source='builtin' | 'override' | 'probe' | 'discovery'`。

```ts
interface AgentDefinition {
  id: string;
  displayName: string;
  runtime: "acpx" | "magic";
  family?: string;
  command?: string;
  args?: string[];
  fallbackCommands?: string[];
  iconPath: string;
  tier: "core" | "verified" | "experimental" | "hidden";
  capabilities: AgentCapabilities;
  envSchema: AgentEnvSchema;
  modelConfigSchema?: ModelConfigSchema;
  availabilityProbe: AvailabilityProbeSpec;
}
```

### Agent 分层

默认 UI 只展示 `core` 和 `verified`。`experimental` 放高级区或实验区，`hidden` 只可通过配置或 discovery 使用。

core / verified 初始建议：

- `codex`
- `claude`
- `opencode`
- `cursor`
- `kiro`
- `trae`
- `nga`
- `codegenie`
- `cangjie-magic`

experimental 初始建议：

- `pi`
- `openclaw`
- `gemini`
- `copilot`
- `droid`
- `fast-agent`
- `grok-build`
- `iflow`
- `kilocode`
- `kimi`
- `mux`
- `qoder`
- `qwen`

### NGA / CodeGenie

NGA 和 CodeGenie 是 OpenCode-compatible agent，但必须作为独立 agent id，不与 `opencode` 共用 session scope。

```json
{
  "id": "nga",
  "runtime": "acpx",
  "family": "opencode-compatible",
  "command": "ngagent",
  "args": ["acp"],
  "fallbackCommands": ["nga"]
}
```

```json
{
  "id": "codegenie",
  "runtime": "acpx",
  "family": "opencode-compatible",
  "command": "codegenie",
  "args": ["acp"]
}
```

### 图标策略

核心和 verified agent 必须有本地 SVG/PNG 图标资产。experimental agent 可使用统一 generic provider SVG，但不能用 emoji。

已有图标：

- `public/engines/claude.svg`
- `public/engines/codex.svg`
- `public/engines/opencode.svg`
- `public/engines/cursor.svg`
- `public/engines/kiro.svg`
- `public/engines/trae.svg`
- `public/engines/code-agent.svg`，可用于 NGA
- `public/engines/code-genie.svg`，可用于 CodeGenie
- `public/engines/magic-cli.svg`

缺失图标：

- `pi`
- `openclaw`
- `gemini`
- `copilot`
- `droid`
- `fast-agent`
- `grok-build`
- `iflow`
- `kilocode`
- `kimi`
- `mux`
- `qoder`
- `qwen`

## Runtime Adapters

### AcpxAdapter

`AcpxAdapter` 封装 `acpx/runtime`，但 acpx 类型不泄漏到业务层。

职责：

- 构造 acpx runtime options。
- 根据 agent registry resolve command/custom agent。
- create/load acpx session。
- run turn。
- cancel / close。
- 查询 capabilities/status/models/commands。
- 归一化 acpx event 为 `AdapterRuntimeEvent`。
- 返回 provider binding 更新。

不负责：

- 平台 session 创建。
- 队列决策。
- 权限最终裁决。
- skills/MCP/env/profile 合并。
- compact/fork 事务。
- UI process blocks。

### MagicAdapter

`cangjie-magic` 作为一等 runtime，接入同一 `RuntimeAdapter`。

要求：

- 如果 Magic 底层有原生 session，记录到 `runtime_bindings`。
- 如果无原生 session，由 `RuntimeSessionStore` 模拟平台 session。
- 输出同一 `AdapterRuntimeEvent`。
- 支持 cancel，至少能中断当前 turn。
- usage/cost 可缺失，但必须显式标记 `missing: true`，必要时附 `sourceStatus: "missing"`。
- 所有诊断写入 trace store。

## SQLite Runtime DB

SQLite 是 runtime source of truth。内存只做 lease/cache。

数据库要求：

- 启用 foreign key。
- 启用 WAL。
- 设置 busy timeout。
- 写入状态机、领取 queue、追加事件、完成 turn、cancel、migration 使用事务。
- 高竞争写入使用 `BEGIN IMMEDIATE`。
- 所有 JSON 字段在应用层用 schema 校验；SQLite 存储前必须通过 validator。

### 核心表

```sql
runtime_sessions(
  id text primary key,
  kind text not null,
  agent_id text not null,
  model_route_id text,
  owner_user_id text,
  title text,
  status text not null,
  working_directory text not null,
  created_at text not null,
  updated_at text not null,
  foreign key(model_route_id) references model_routes(id) on delete set null,
  check(kind in ('chat','agent','workflow-agent','workflow-supervisor','agora','probe','diagnostic')),
  check(status in ('creating','active','archived','compacted','forking','compacting','invalid','deleted'))
);

runtime_bindings(
  id text primary key,
  session_id text not null,
  runtime text not null,
  role text not null default 'primary',
  generation integer not null default 1,
  external_record_id text,
  external_session_id text,
  provider_session_id text,
  raw_json text not null,
  created_at text not null,
  updated_at text not null,
  foreign key(session_id) references runtime_sessions(id) on delete cascade,
  check(runtime in ('acpx','magic')),
  check(role in ('primary','handoff-source','handoff-target','migration','diagnostic')),
  unique(session_id, runtime, role, generation)
);

runtime_turns(
  id text primary key,
  session_id text not null,
  request_id text not null,
  trace_id text not null,
  status text not null,
  interrupt_policy text not null,
  input_text text not null,
  queued_at text not null,
  started_at text,
  finished_at text,
  lease_owner text,
  lease_token text,
  lease_expires_at text,
  cancel_reason text,
  cancel_request_id text,
  error_json text,
  usage_json text,
  cost_json text,
  foreign key(session_id) references runtime_sessions(id) on delete cascade,
  unique(session_id, request_id),
  unique(trace_id),
  check(status in ('queued','running','canceling','cancelled','completed','failed','dropped','expired','invalid')),
  check(interrupt_policy in ('queue','cancel-and-send','reject'))
);

runtime_events(
  id text primary key,
  session_id text not null,
  turn_id text,
  trace_id text not null,
  seq integer not null,
  type text not null,
  correlation_id text,
  parent_event_id text,
  message_id text,
  tool_call_id text,
  payload_json text not null,
  redacted integer not null,
  created_at text not null,
  foreign key(session_id) references runtime_sessions(id) on delete cascade,
  foreign key(turn_id) references runtime_turns(id) on delete cascade,
  foreign key(parent_event_id) references runtime_events(id) on delete set null,
  check(redacted in (0,1)),
  unique(session_id, seq)
);

runtime_session_snapshots(
  id text primary key,
  session_id text not null,
  turn_id text,
  agent_id text not null,
  model_route_id text,
  system_prompt_hash text,
  skills_revision text,
  mcp_revision text,
  interrupt_policy text not null,
  skills_json text not null,
  mcp_servers_json text not null,
  env_profile_id text,
  secret_profile_id text,
  permission_policy_id text,
  cwd text not null,
  snapshot_json text not null,
  created_at text not null,
  foreign key(session_id) references runtime_sessions(id) on delete cascade,
  foreign key(turn_id) references runtime_turns(id) on delete set null,
  foreign key(model_route_id) references model_routes(id) on delete set null,
  foreign key(env_profile_id) references env_profiles(id) on delete set null,
  foreign key(secret_profile_id) references secret_profiles(id) on delete set null,
  foreign key(permission_policy_id) references permission_policies(id) on delete set null,
  check(interrupt_policy in ('queue','cancel-and-send','reject'))
);

runtime_session_operations(
  id text primary key,
  session_id text not null,
  target_session_id text,
  kind text not null,
  status text not null,
  trace_id text not null,
  request_json text not null,
  result_json text,
  error_json text,
  compensation_json text,
  created_at text not null,
  updated_at text not null,
  foreign key(session_id) references runtime_sessions(id) on delete cascade,
  foreign key(target_session_id) references runtime_sessions(id) on delete set null,
  check(kind in ('fork','compact','restore','rollback','summary-handoff')),
  check(status in ('pending','external-running','finalizing','completed','failed','compensating','compensated'))
);

runtime_session_edges(
  id text primary key,
  operation_id text,
  from_session_id text not null,
  to_session_id text not null,
  kind text not null,
  status text not null,
  at_turn_id text,
  at_message_id text,
  summary text,
  error_json text,
  metadata_json text not null,
  created_at text not null,
  foreign key(operation_id) references runtime_session_operations(id) on delete set null,
  foreign key(from_session_id) references runtime_sessions(id) on delete cascade,
  foreign key(to_session_id) references runtime_sessions(id) on delete cascade,
  check(from_session_id <> to_session_id),
  check(kind in ('fork','compact','restore','rollback','summary-handoff')),
  check(status in ('pending','active','failed')),
  unique(from_session_id, to_session_id, kind)
);

runtime_traces(
  id text primary key,
  trace_id text not null,
  session_id text,
  turn_id text,
  level text not null,
  source text not null,
  payload_json text not null,
  redacted integer not null,
  created_at text not null,
  foreign key(session_id) references runtime_sessions(id) on delete cascade,
  foreign key(turn_id) references runtime_turns(id) on delete cascade,
  check(level in ('debug','info','warning','error')),
  check(redacted in (0,1))
);

agent_runtime_state(
  agent_id text primary key,
  enabled integer not null default 1,
  hidden integer not null default 0,
  override_json text,
  availability_status text not null default 'unknown',
  availability_checked_at text,
  env_readiness_json text,
  capability_probe_json text,
  discovery_json text,
  created_at text not null,
  updated_at text not null,
  check(enabled in (0,1)),
  check(hidden in (0,1)),
  check(availability_status in ('unknown','available','missing','misconfigured','failed'))
);

runtime_projection_cache(
  id text primary key,
  session_id text not null,
  projection text not null,
  version integer not null,
  last_seq integer not null,
  payload_json text not null,
  created_at text not null,
  updated_at text not null,
  foreign key(session_id) references runtime_sessions(id) on delete cascade,
  check(projection in ('chat','workflow','process-block')),
  unique(session_id, projection, version)
);
```

业务层只使用 `runtime_sessions.id`。`runtime_bindings` 仅 adapter 和 diagnostics 可读。

索引要求：

- `runtime_turns(session_id, status, queued_at)`
- `runtime_turns(status, queued_at, id)`
- partial unique：`runtime_turns(session_id) where status in ('running','canceling')`
- `runtime_turns(trace_id)`
- `runtime_events(session_id, seq)`
- `runtime_events(turn_id, seq)`
- `runtime_events(trace_id, seq)`
- `runtime_events(correlation_id)`
- `runtime_traces(trace_id, created_at)`
- `runtime_traces(session_id, turn_id, created_at)`
- `runtime_sessions(owner_user_id, updated_at)`
- `runtime_sessions(kind, status, updated_at)`
- `runtime_session_operations(session_id, kind, status, created_at)`
- `runtime_session_edges(from_session_id, kind)`
- `runtime_session_edges(to_session_id, kind)`
- `agent_runtime_state(availability_status, availability_checked_at)`
- `runtime_projection_cache(session_id, projection, version)`

外部 id 泄漏约束：

- `runtime_bindings.external_record_id`、`external_session_id`、`provider_session_id`、`raw_json` 不得进入普通 API DTO、ChatProjection、WorkflowProjection 或前端 state。
- 只有 adapter、migration、diagnostics、脱敏 trace export 可以读取。
- diagnostics 默认脱敏，读取原始 binding 需要管理员权限和显式 debug 开关。

事务与 lease：

- `openSession`：事务内创建 `runtime_sessions`、snapshot、binding placeholder。
- `runTurn` 入队：事务内插入 `runtime_turns(status='queued')`，`request_id` 幂等。
- 领取 turn：worker 使用 `BEGIN IMMEDIATE` 选取最早 queued turn，并 CAS 更新为 `running`，同时写入 `lease_owner`、`lease_token`、`lease_expires_at`。同一 session 同时只能一个 running/canceling turn，由 partial unique index 兜底。
- lease 默认 30 秒，worker 每 10 秒 heartbeat 延长。所有追加事件、完成、cancel finalize 都必须携带 `lease_token` 做 CAS。
- lease 过期后，reclaimer 根据 adapter status 决策：仍在运行则续租给新 worker；已退出且无 terminal event 则 turn=`failed`；无法判断则 turn=`expired` 且 session=`invalid`。
- 追加事件：事务内计算下一个 `seq` 并写入，失败重试，保证 `unique(session_id, seq)`。
- 完成 turn：事务内写 status、usage、cost、finished_at，释放 lease，并同步更新 projection cache 到同一 `last_seq`。
- cancel：queued turn 不调用 adapter，按请求语义变为 `dropped` 或 `cancelled`；running turn 先 CAS 到 `canceling`，再事务外调用 adapter cancel，最后携带 lease/cancel token finalize。

Cancel 状态机：

- `DELETE /turns/:turnId` 只允许 queued，成功后 turn=`dropped`。
- `POST /turns/:turnId/cancel` 对 queued turn 直接 turn=`cancelled`，对 running turn 进入 `canceling`。
- adapter cancel 成功：turn=`cancelled`，写 `turn.cancelled`。
- adapter cancel 超时：默认 10 秒；turn=`failed`、session=`invalid`，新输入必须 fork 或新建 session。
- adapter 已自然完成且完成事务先提交：cancel 返回既有 terminal turn，标记 `retryable=false`。
- 重复 cancel 使用 `cancel_request_id` 幂等，返回同一 cancel 结果。
- `POST /runtime-sessions/:id/cancel` 默认取消当前 running 并 drop 所有 queued；不得直接删除 session。

## Canonical Runtime Events

废弃 `EngineStreamEvent` 作为核心事件。新事件是结构化 runtime event。

事件类型：

- `turn.started`
- `turn.queued`
- `turn.canceling`
- `turn.cancelled`
- `turn.completed`
- `turn.failed`
- `message.delta`
- `message.completed`
- `thought.delta`
- `tool.started`
- `tool.updated`
- `tool.output`
- `tool.completed`
- `tool.failed`
- `usage.updated`
- `permission.requested`
- `permission.resolved`
- `command.available`
- `command.invoked`
- `status.changed`
- `diagnostic`

事件 envelope：

```ts
interface RuntimeEvent {
  id: string;
  sessionId: string;
  turnId?: string;
  traceId: string;
  seq: number;
  type: RuntimeEventType;
  correlationId?: string;
  parentEventId?: string;
  messageId?: string;
  toolCallId?: string;
  payload: unknown;
  redacted: boolean;
  createdAt: string;
}
```

规则：

- `seq` 在 `sessionId` 内单调递增。
- `correlationId` 串联 adapter event、permission request、tool lifecycle。
- `messageId` 串联同一 assistant/user message 的 delta 和 completed。
- `toolCallId` 串联 tool started/updated/output/completed/failed。
- projection 只能消费 `RuntimeEvent`，不得直接消费 `AdapterRuntimeEvent`。
- adapter 不得 import projection 类型。
- `runtime_events` 表必须把 `trace_id`、`correlation_id`、`parent_event_id`、`message_id`、`tool_call_id`、`redacted` 落独立列，不能只塞进 `payload_json`。
- event 写入和 projection cache 更新在同一个事务中完成；projection 更新失败时 event 事务回滚，worker 重试。

Projection：

- Chat UI 使用 `ChatProjection`。
- Workflow 使用 `WorkflowProjection`。
- ACE process blocks 使用 `ProcessBlockProjection`。
- Diagnostics 使用 raw `runtime_events` + `runtime_traces`。
- Projection 是可重建缓存，不是 source of truth。
- `runtime_projection_cache.version` 随 projection schema 递增；版本变化时从 `runtime_events` 全量重建。
- projection cache 缺失或 `last_seq` 落后时，查询层可以同步追赶；追赶失败返回结构化错误，不读取 adapter raw event。

过程块不再是 runtime source of truth。

## Models SQLite Source of Truth

`configs/models/models.yaml` 只作为 seed/import/export。运行时只读 SQLite。

### 表结构

```sql
model_catalog(
  id text primary key,
  label text not null,
  status text not null,
  context_window integer,
  created_at text not null,
  updated_at text not null,
  check(status in ('active','inactive','deprecated')),
  check(context_window is null or context_window > 0)
);

model_providers(
  model_id text not null,
  provider text not null,
  primary key(model_id, provider),
  foreign key(model_id) references model_catalog(id) on delete cascade
);

model_routes(
  id text primary key,
  model_id text not null,
  agent_id text not null,
  runtime text not null,
  provider text,
  provider_model text not null,
  config_options_json text not null,
  config_schema_json text,
  capabilities_json text,
  env_requirements_json text,
  health_status text not null default 'unknown',
  last_verified_at text,
  source text not null,
  priority integer not null default 100,
  is_default integer not null default 0,
  status text not null default 'active',
  created_at text not null,
  updated_at text not null,
  foreign key(model_id) references model_catalog(id) on delete cascade,
  check(runtime in ('acpx','magic')),
  check(health_status in ('unknown','operational','degraded','down')),
  check(is_default in (0,1)),
  check(status in ('active','inactive','deprecated'))
);

model_pricing(
  id text primary key,
  model_id text not null,
  provider text,
  currency text not null default 'USD',
  input_per_1m real,
  output_per_1m real,
  cache_write_per_1m real,
  cache_read_per_1m real,
  created_at text not null,
  updated_at text not null,
  foreign key(model_id) references model_catalog(id) on delete cascade,
  check(input_per_1m is null or input_per_1m >= 0),
  check(output_per_1m is null or output_per_1m >= 0),
  check(cache_write_per_1m is null or cache_write_per_1m >= 0),
  check(cache_read_per_1m is null or cache_read_per_1m >= 0)
);

model_discovery_cache(
  id text primary key,
  agent_id text not null,
  source text not null,
  models_json text not null,
  discovered_at text not null
);
```

模型表约束：

- 每个 `(agent_id, model_id)` 最多一个 active default route，使用 partial unique index：`unique(agent_id, model_id) where status='active' and is_default=1`。
- 同一 agent 下允许多个 route 指向同一 `provider/provider_model`，但必须通过 `source` 或 `config_options_json` 区分；默认 route 只能有一个。
- route resolve 顺序：显式 `modelRouteId` > active default > 最低 `priority` > 最近 `last_verified_at` > 稳定 `id` 排序。
- `priority` 并列不是错误，但 resolver 必须 deterministic。

建议索引：

- `model_routes(agent_id, status, priority)`
- `model_routes(model_id, agent_id)`
- `model_routes(health_status, last_verified_at)`
- `model_routes(agent_id, provider, provider_model, status)`
- `model_discovery_cache(agent_id, discovered_at)`

执行时必须解析为 `ResolvedModelRoute`：

```ts
interface ResolvedModelRoute {
  modelRouteId: string;
  agentId: string;
  runtime: "acpx" | "magic";
  providerModel: string;
  configOptions: Record<string, unknown>;
  envRequirements: EnvRequirement[];
  capabilities: RuntimeCapabilities;
}
```

旧字段只在一次性 migration 中支持：

- `value`
- `costMultiplier`
- `endpoints`
- `engines`
- `model[reasoning=medium]`

迁移后 API 不返回旧 `ModelOption`。

## Probes / Benchmarks / Usage

模型探针、能力测评、usage/cost 都写 SQLite。

建议表：

```sql
model_probes(
  id text primary key,
  model_route_id text not null,
  name text not null,
  enabled integer not null,
  interval_minutes integer not null,
  timeout_ms integer not null,
  next_run_at text,
  last_run_at text,
  lease_owner text,
  lease_token text,
  lease_expires_at text,
  created_at text not null,
  updated_at text not null,
  foreign key(model_route_id) references model_routes(id) on delete cascade,
  check(enabled in (0,1)),
  check(interval_minutes > 0),
  check(timeout_ms > 0)
);

model_probe_runs(
  id text primary key,
  probe_id text not null,
  model_route_id text not null,
  status text not null,
  started_at text not null,
  finished_at text,
  latency_ms integer,
  usage_json text,
  cost_json text,
  output_preview text,
  error_json text,
  trace_id text,
  foreign key(probe_id) references model_probes(id) on delete cascade,
  foreign key(model_route_id) references model_routes(id) on delete cascade,
  check(status in ('running','operational','degraded','down','failed','cancelled')),
  check(latency_ms is null or latency_ms >= 0)
);

model_benchmark_runs(
  id text primary key,
  model_route_id text not null,
  suite_id text not null,
  suite_version text not null,
  status text not null,
  score real,
  started_at text not null,
  finished_at text,
  usage_json text,
  cost_json text,
  trace_id text,
  foreign key(model_route_id) references model_routes(id) on delete cascade,
  check(status in ('queued','running','completed','failed','cancelled')),
  check(score is null or (score >= 0 and score <= 1))
);

model_benchmark_items(
  id text primary key,
  run_id text not null,
  item_id text not null,
  status text not null,
  score real,
  started_at text,
  finished_at text,
  metrics_json text not null,
  usage_json text,
  cost_json text,
  error_json text,
  foreign key(run_id) references model_benchmark_runs(id) on delete cascade,
  check(status in ('queued','running','completed','failed','cancelled','skipped')),
  check(score is null or (score >= 0 and score <= 1)),
  unique(run_id, item_id)
);

model_usage_daily(
  day text not null,
  model_route_id text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  cost_json text not null,
  primary key(day, model_route_id),
  foreign key(model_route_id) references model_routes(id) on delete cascade,
  check(input_tokens >= 0),
  check(output_tokens >= 0),
  check(cache_creation_input_tokens >= 0),
  check(cache_read_input_tokens >= 0)
);
```

探针使用 `model_route_id`，不是 `engine + model`。

Usage 统一类型：

```ts
interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
  missing?: boolean;
}

interface CostUsage {
  amount?: number;
  currency?: string;
  costUsd?: number;
  estimated: boolean;
  missing?: boolean;
}
```

规则：

- provider/acpx 上报优先。
- 未上报是 `missing`，不是 0。
- 没有真实 cost 时用 `model_pricing` 估算。
- 所有 benchmark run 记录 usage/cost。
- probe 调度使用 `model_probes` lease 字段，领取和 heartbeat 规则与 runtime turn 一致。
- 同一 `model_route_id + probe_id` 不允许并发 running；用 partial unique index 兜底。
- benchmark run cancel 时，queued item -> `cancelled`，running item 尽力取消，无法确认则 run=`failed` 并写 trace。
- usage 聚合与 terminal turn/probe/benchmark 写入在同一事务中完成。
- 索引要求：`model_probe_runs(model_route_id, started_at)`、`model_benchmark_runs(model_route_id, started_at)`、`model_usage_daily(model_route_id, day)`、`model_probes(next_run_at, enabled)`。

## Secrets / Env

环境变量升级为 secret/env profile。

```sql
secret_profiles(
  id text primary key,
  name text not null,
  owner_user_id text,
  scope text not null,
  created_at text not null,
  updated_at text not null,
  check(scope in ('personal','global','workspace'))
);

secret_values(
  id text primary key,
  profile_id text not null,
  key text not null,
  encrypted_value text not null,
  secret integer not null,
  created_at text not null,
  updated_at text not null,
  foreign key(profile_id) references secret_profiles(id) on delete cascade,
  check(secret in (0,1)),
  unique(profile_id, key)
);

env_profiles(
  id text primary key,
  name text not null,
  owner_user_id text,
  scope text not null,
  secret_profile_id text,
  vars_json text not null,
  created_at text not null,
  updated_at text not null,
  foreign key(secret_profile_id) references secret_profiles(id) on delete set null,
  check(scope in ('personal','global','workspace'))
);
```

约束：

- `secret_profiles(owner_user_id, scope, name)` 唯一。
- `env_profiles(owner_user_id, scope, name)` 唯一。
- `env_profiles.vars_json` 只能保存非敏感配置；敏感值必须进入 `secret_values.encrypted_value`。
- secret 加密密钥来自本机安全存储或 ACEHarness master key；迁移前必须验证密钥可用。
- secret export 默认不包含 value，只导出 key 和引用。
- secret rotation 创建新 encrypted value revision；旧 revision 仅保留到没有 runtime snapshot 引用。
- secret key 不可用时 runtime profile readiness=`misconfigured`，不得静默回退到 process env。
- 变量解析优先级：turn request override > runtime profile env vars > secret profile refs > agent default env > process env。
- 敏感变量冲突时 secret profile 优先于同名明文 env；UI 必须提示冲突。
- 索引要求：`secret_profiles(owner_user_id, scope, name)`、`secret_values(profile_id, key)`、`env_profiles(owner_user_id, scope, name)`。

默认提示四个变量：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`

长期由 agent registry 提供 env schema。

日志规则：

- 不记录 secret value。
- 只记录 key 名、来源 profile、readiness。
- stderr 和 trace 必须脱敏。
- 诊断包导出默认脱敏。

## Permission

默认权限最大开放，即不限制。

默认策略：

```ts
defaultPermissionPolicy = "unrestricted"
```

策略集合：

- `unrestricted`：默认。自动通过所有 runtime permission request。
- `approve-reads`：读自动通过，写/执行可继续细分。
- `ask`：敏感操作询问。
- `deny-destructive`：阻止高风险操作。
- `deny-all`：全部拒绝。

标准 permission request：

```ts
interface RuntimePermissionRequest {
  id: string;
  sessionId: string;
  turnId: string;
  agentId: string;
  operation: "read" | "write" | "execute" | "network" | "mcp" | "unknown";
  resource?: string;
  cwd?: string;
  proposedCommand?: string;
  proposedDiff?: string;
  risk: "low" | "medium" | "high";
  raw: unknown;
}
```

即使默认 unrestricted，也要记录 permission request 和 auto decision，便于审计。

`unrestricted` 精确定义：

- 自动批准文件读取。
- 自动批准文件写入和删除。
- 自动批准 shell/子进程执行。
- 自动批准网络访问。
- 自动批准 MCP tool 调用。
- 自动批准工作区外路径访问。
- 自动批准 destructive diff 或 destructive command。

但仍必须：

- 生成 `permission.requested` 和 `permission.resolved` 事件。
- 在 trace 中记录 operation、resource、risk、decision=`auto-approved`。
- UI 在 runtime profile 中显示当前为 unrestricted，并提供一键切换到更严格策略。

## Runtime Profiles

Profile 不是一个扁平对象，而是多个生命周期不同实体的快照。

```ts
interface RuntimeProfileSnapshot {
  agentId: string;
  modelRouteId: string;
  cwd: string;
  systemPromptHash: string;
  skillsRevision: string;
  mcpRevision: string;
  envProfileId?: string;
  secretProfileId?: string;
  permissionPolicyId: string;
  interruptPolicy: "queue" | "cancel-and-send" | "reject";
}
```

每个 session/turn 都保存 snapshot，避免 profile 修改影响历史 session。

## Queue / Interrupt

Turn queue 持久化在 `runtime_turns`。

Turn 状态：

- `queued`
- `running`
- `canceling`
- `cancelled`
- `completed`
- `failed`
- `dropped`
- `expired`
- `invalid`

默认打断输入策略：

- `queue`

可选策略：

- `queue`：运行中输入进入队列。
- `cancel-and-send`：取消当前 turn，成功后发送新输入。
- `reject`：运行中拒绝新输入。

规则：

- cancel 超时后 session 标记为 `invalid` 或强制 fork。
- tool call 执行中允许 cancel，但结果按 adapter 能力处理。
- queued prompt 可撤销。
- 多 tab 同 session 通过 runtime_turns 仲裁。
- 浏览器断连不取消 turn，除非用户显式停止。
- `POST /turns` 必须带 `requestId` 幂等键。
- queued turn 按 `queued_at` 和自增序号 FIFO 执行。
- cancel 超时默认 10 秒；超时后 turn=`failed`、session=`invalid`，新输入必须 fork 或新建 session。
- `cancel-and-send` 中 cancel 失败时，新输入进入新 fork session，不继续污染原 session。

## Session Graph / Compact / Fork

compact 和 fork 是 session graph 操作。

`runtime_session_edges.kind`：

- `fork`
- `compact`
- `restore`
- `rollback`
- `summary-handoff`

Compact 策略：

1. `native`：runtime/agent 原生支持。
2. `command`：调用 agent advertised command，例如 `/compact`。
3. `summary-handoff`：用模型生成摘要，创建新 session。
4. `transcript-only`：仅压缩 ACEHarness transcript。

Fork 策略：

1. `native`
2. `load-and-handoff`
3. `transcript-summary`

compact/fork 不允许把外部 runtime 调用包进长 SQLite transaction。使用 saga/两阶段状态：

1. 事务内创建 pending operation、目标 session placeholder、edge placeholder、trace。
2. 事务外调用 adapter/native command/manual summary。
3. 事务内 finalize：写入 binding、snapshot、edge、chat/workflow binding、trace。
4. 失败时事务内标记 failed，并记录补偿动作；外部已创建的 provider session 通过 best-effort close。

## Skills / MCP

Skills/MCP UI 可保留现有入口，但 runtime 数据必须快照化。

规则：

- session/turn 保存 skills revision。
- session/turn 保存 MCP revision。
- MCP env 使用 secret/env ref。
- MCP 变化默认不修改旧 session；需要继续、fork 或新建。
- adapter 只接收 resolved MCP config。

## API 设计

新 API 使用 runtime/agents/session 语义。

### Agents

- `GET /api/agents`
- `GET /api/agents/:id`
- `GET /api/agents/:id/availability`
- `GET /api/agents/:id/models`
- `GET /api/agents/:id/capabilities`

### Runtime Settings

- `GET /api/runtime/settings`
- `PUT /api/runtime/settings`
- `GET /api/runtime/profiles`
- `POST /api/runtime/profiles`
- `PUT /api/runtime/profiles/:id`

### Runtime Sessions

- `POST /api/runtime-sessions`
- `GET /api/runtime-sessions/:id`
- `POST /api/runtime-sessions/:id/turns`
- `GET /api/runtime-sessions/:id/turns/:turnId`
- `POST /api/runtime-sessions/:id/turns/:turnId/cancel`
- `DELETE /api/runtime-sessions/:id/turns/:turnId`
- `POST /api/runtime-sessions/:id/cancel`
- `POST /api/runtime-sessions/:id/compact`
- `POST /api/runtime-sessions/:id/fork`
- `GET /api/runtime-sessions/:id/events`
- `GET /api/runtime-sessions/:id/traces`
- `GET /api/runtime-sessions/:id/diagnostic-bundle`

HTTP 契约：

- `POST /turns` 接收 `requestId`，重复 requestId 返回既有 turn。
- `POST /turns` 支持 `stream=sse|ndjson|none`。
- `GET /events` 支持 `cursor`、`afterSeq`、`limit`。
- `GET /traces` 仅 diagnostics 权限可读，默认脱敏。
- queued turn 删除只允许 status=`queued`。
- 错误码使用结构化 `{ code, message, retryable, detail }`。

Streaming / cursor：

- cursor 是 opaque base64url JSON，内容至少包含 `{ sessionId, seq }`，服务端必须校验 sessionId。
- 同时传 `cursor` 和 `afterSeq` 时以 `cursor` 为准；`afterSeq` 只用于简单恢复。
- SSE event id 使用 `seq`；浏览器 `Last-Event-ID` 等价于 `afterSeq`。
- SSE/NDJSON replay 从 `seq > afterSeq` 或 `seq > cursor.seq` 开始。
- `limit` 默认 200，最大 1000；超过返回 `LIMIT_EXCEEDED`。
- streaming 心跳 15 秒一次；客户端断线不取消 turn。
- turn terminal event 写出并 flush 后关闭 `POST /turns?stream=*` 响应。
- backpressure 超过服务端缓冲上限时断开 stream，客户端用 cursor 恢复。

核心 DTO：

```ts
type OpenRuntimeSessionRequest = {
  agentId: string;
  modelRouteId?: string;
  cwd: string;
  kind: RuntimeSessionKind;
  runtimeProfileId?: string;
};

type RunTurnRequest = {
  requestId: string;
  input: string;
  interruptPolicy?: "queue" | "cancel-and-send" | "reject";
  stream?: "sse" | "ndjson" | "none";
};

type CancelTurnRequest = {
  requestId: string;
  reason?: string;
};
```

HTTP status：

- 幂等命中返回 `200` 和既有 resource。
- 新建 session/turn 返回 `201`。
- queued 删除/cancel 成功返回 `200`。
- 权限不足 `403`，找不到 `404`，状态冲突 `409`，校验失败 `422`。

### Models

- `GET /api/models/catalog`
- `GET /api/models/routes`
- `POST /api/models/routes`
- `POST /api/models/discover`
- `POST /api/models/import`
- `GET /api/models/export`

### Secrets / Env

- `GET /api/secrets/profiles`
- `POST /api/secrets/profiles`
- `PUT /api/secrets/profiles/:id`
- `POST /api/secrets/profiles/:id/test`
- `GET /api/env/profiles`
- `POST /api/env/profiles`

### Legacy

`/api/engine`、旧 `/api/models`、旧 chat request 字段不做长期兼容。可提供一次性 migration endpoint 或启动 migration。

## TanStack Client State / Performance

仓库已经使用 TanStack Start、Router、React Query、React DB、React Virtual、TanStack AI。迁移不新增另一套前端数据层，必须纳入现有 TanStack 模式。

分层：

- SQLite 是服务端 source of truth。
- React Query 负责 API fetch、mutation、cache invalidation。
- TanStack DB / React DB 负责客户端响应式镜像和乐观更新。
- Router/Start 保持现有 route 文件组织。
- TanStack AI 可继续作为消息标准化薄层，但不成为 runtime source of truth。

Runtime collections：

- `runtimeSessionsCollection`
- `runtimeTurnsCollection`
- `runtimeEventsCollection`
- `runtimeChatProjectionCollection`
- `runtimeProcessBlocksCollection`
- `agentRegistryCollection`
- `agentRuntimeStateCollection`
- `modelCatalogCollection`
- `modelRoutesCollection`
- `modelProbesCollection`
- `modelProbeRunsCollection`
- `modelBenchmarkRunsCollection`

Streaming 客户端协议：

- 初始页面用 React Query 获取 session/projection snapshot。
- SSE/NDJSON 增量按 `sessionId + seq` 幂等 upsert 到 TanStack DB。
- 断线后使用 `afterSeq` 或 cursor recover。
- 高频 `message.delta`、`thought.delta`、`tool.updated` 必须用 `requestAnimationFrame` 或 50-100ms micro-batch 合批写入，避免每 token 触发全树 render。
- terminal event 到达后 invalidate 对应 Query key，并以服务端 terminal DTO 校准本地镜像。

缓存边界：

- Query key 只能使用平台 id：`runtimeSessionId`、`turnId`、`modelRouteId`、`probeId`、`benchmarkRunId`、`projectionVersion`。
- `runtime_bindings.*`、provider/acpx native id、secret value、raw auth id 不得进入 React Query cache、TanStack DB collection 或普通 DTO。
- secret/env 客户端只缓存 profile metadata、key 名、readiness、冲突状态、`lastCheckedAt`。

性能策略：

- Chat UI 读取 projection cache，不从全量 raw events 每次重算。
- raw events、trace、probe runs、benchmark items 只在 diagnostics/detail 视图分页加载。
- 固定或近似高度长列表使用 TanStack Virtual。
- 动态高度 Chat message 优先保留 `content-visibility: auto`，避免动态虚拟列表重叠。
- diagnostics、benchmark detail、large trace viewer、Monaco/Streamdown 等重组件按 route 或 drawer 动态加载。
- Router preload 只 preload 页面壳和轻量 metadata，不 preload 大型 events/traces。
- availability/probe/env readiness 不允许在列表渲染中逐项 waterfall；必须批量 API 或后台刷新。

Table/Form 决策：

- 当前自研 `DataTable` 继续可用。
- TanStack Table 可作为复杂 runtime admin 表格候选，例如模型路线、benchmark items、trace table；不是迁移阻塞项。
- TanStack Form 暂不作为迁移要求，保留现有表单栈，除非后续 runtime schema 表单需要强类型 field graph。

## UI 设计

UI 迁移原则：不做新的“Runtime 控制台”视觉语言。保留现有导航、页面入口、组件体系和主题 token，把新 runtime 能力融入现有工作流。

视觉和组件约束：

- 继续使用现有 `PageHeader`、`PageToolbar`、`DataCard`、`DataTable`、`StatusPill`、`DetailDrawer`、`Tabs`、`ObjectEditDrawer` 等组件。
- 继续使用现有 `bg-background`、`bg-card`、`border`、`muted`、少量强调色的主题方式。
- 不新增 acpx 专属设置页或 Runtime 专属大面板。
- 页面文案使用用户熟悉的“引擎 / Agent / 模型路线 / 探针 / 诊断”，避免把数据库字段直接暴露为主文案。

### `/engines`

继续作为页面路由和导航名称，中文仍叫“引擎管理”。domain model 不再叫 Engine，但用户入口保持稳定。

页面内容：

- 顶部摘要：当前默认引擎/Agent、默认模型路线、权限策略、env readiness、可用性摘要。
- 主区：core/verified Agent 卡片，保留现有图标、可用性 pill、安装说明 drawer。
- 卡片字段：Agent 名称、模型路线、env readiness、capabilities、diagnostics summary。
- Runtime/acpx 字段只弱展示在高级诊断区，不作为普通状态。
- 高级区：experimental agents、adapter/acpx 版本、raw diagnostics。
- 用“接入方式：Runtime Adapter”替代旧 driver 位，避免用户误以为能力丢失。

页面不再展示 SDK/stdio driver 控件，且禁止这类控件回归。

### `/models`

保留现有 Models 页面和 Tab 结构，底层改为 SQLite-first：

- `模型目录`：`model_catalog`。
- `模型路线`：`model_routes`，按 Agent/Provider 分组，支持默认路线。
- `探针监控`：使用 `modelRouteId`，UI 显示“模型路线”，不直接暴露裸 id。
- `诊断评测`：保留现有诊断工作台，底层接 runtime trace / benchmark。
- YAML 只显示为导入、导出、种子来源，不作为运行态配置。

### Chat UI

Chat 主 UI 不展示 acpx 内部状态。

用户可见：

- 当前 agent/model。
- 运行中、排队中、取消中、失败。
- 停止、继续输入、compact、fork。
- queue 策略下的轻量 pending message，可撤销。
- cancel-and-send 策略下的取消中状态。
- reject 策略下的轻量提示。

隐藏但记录：

- acpx record id。
- provider session id。
- queue owner。
- lease owner。
- raw acpx status。
- stderr。
- auth method id。
- retry/heartbeat。

交互放置：

- compact 保留 `/compact`，并放入会话菜单。
- fork 放入会话菜单或消息更多菜单，文案用“从这里分叉”。
- compact/fork 不作为 Composer 常驻重控件。
- Run History / Diagnostics 是 trace 和诊断包主要入口；普通用户看脱敏摘要，管理员 debug 下看更完整 trace。

### Secrets / Env

在系统设置中增强，不新建 acpx 设置页。复用现有 Runtime / Security / Advanced 分区。

能力：

- secret profile。
- env profile。
- agent env readiness。
- MCP env ref 校验。
- 连接测试。
- 脱敏诊断。
- 默认 `unrestricted` 权限必须在 `/engines` 或 `/settings` 可见，并提供一键切换 `ask` 或 `deny-destructive`。
- secret value 不导出、不进日志、不进普通 API DTO、不进入 Query cache/TanStack DB。

### Skills / MCP UI

Skills/MCP 现有入口和交互保持不变：

- UI 不新增 acpx 状态。
- runtime 只增加 revision snapshot、env ref 校验和 resolved config。
- MCP 运行态诊断进入 trace/diagnostic bundle，不挤进 Skills/MCP 主界面。

### Agent 展示

默认显示 core/verified。experimental 在高级区，hidden 不默认展示。

图标要求：

- core/verified 必须本地 SVG/PNG。
- experimental 可用统一 generic SVG。
- 不使用 emoji。

## Trace / Diagnostics

每个 turn 有 `traceId`。

Trace 记录：

- runtime session id。
- turn id。
- agent id。
- runtime adapter。
- acpx version。
- resolved command。
- cwd。
- env readiness。
- model route。
- permission decisions。
- queue transitions。
- cancel reason。
- tool lifecycle。
- raw/normalized usage。
- raw/normalized cost。
- stderr redacted summary。
- doctor result。

提供：

- `/api/runtime-sessions/:id/traces`
- 脱敏诊断包下载。
- trace retention policy。
- secret redaction policy。

Redaction contract：

- 默认对 prompt、tool input/output、raw adapter event、permission raw、binding raw_json、proposedCommand、proposedDiff、stderr、diagnostic bundle 执行脱敏。
- secret key 对应的 value 必须替换为 `[REDACTED]`。
- 疑似 token/API key/password/private key 的字符串必须替换。
- 脱敏失败时阻断诊断包导出。
- 普通用户只能下载自己 session 的脱敏包；管理员可在显式 debug 开关下查看更完整 trace。

Retention：

- runtime events 默认保留 30 天。
- runtime traces 默认保留 14 天。
- discovery cache 默认保留 7 天。
- probe runs 默认保留最近 240 条或 30 天。
- benchmark item 结果默认保留 30 天。
- 已导出的诊断包不绕过 redaction；导出动作写入 audit trace。

## 迁移策略

这是破坏性迁移。兼容只存在于 migration，不存在于新 runtime。

### Phase 0：新 DB 与 Migration

1. 建立 runtime SQLite schema。
2. 建立 model SQLite schema。
3. 建立 secret/env profile schema。
4. 编写旧配置 migration：
   - `engine/defaultModel/driver/drivers`
   - `activeEngine/engineModels`
   - `models.yaml`
   - `model-probes.json`
   - chat `backendSessionId`
   - workflow attached agent sessions
5. migration 前备份旧数据。
6. 增加 `schema_migrations`、`migration_audit`、`legacy_id_map`。
7. 支持 dry-run，输出迁移报告。
8. 迁移失败时保持旧数据不动，并恢复新 DB 到迁移前状态。
9. migration 后运行一致性校验：孤儿记录、重复默认 route、缺失 binding、缺失 model route。

Migration 元数据表：

```sql
schema_migrations(
  version text primary key,
  run_id text not null,
  applied_at text not null,
  checksum text not null
);

migration_audit(
  id text primary key,
  run_id text not null,
  phase text not null,
  mode text not null,
  status text not null,
  input_hash text not null,
  backup_path text,
  backup_hash text,
  output_counts_json text not null,
  warnings_json text not null,
  errors_json text not null,
  started_at text not null,
  finished_at text,
  check(mode in ('dry-run','apply','rollback')),
  check(status in ('running','completed','failed','rolled-back'))
);

legacy_id_map(
  run_id text not null,
  legacy_type text not null,
  legacy_id text not null,
  new_type text not null,
  new_id text not null,
  metadata_json text not null,
  primary key(run_id, legacy_type, legacy_id, new_type)
);
```

Migration 协议：

- 每次 migration 生成 `run_id`。
- dry-run 写临时 SQLite DB，不修改正式 DB；输出 plan、计数、warnings、errors、legacy_id_map 预览。
- apply 前复制旧配置和旧 DB 到 backup 目录，并记录 sha256。
- apply 使用新 DB 临时文件完成，校验通过后原子 rename 为正式 DB。
- rollback 默认文件级恢复 backup；不依赖 down migration。
- 重复启动时先读取 `migration_audit`：`completed` 直接跳过，`failed/running` 必须进入 recover 或 rollback。
- 所有迁移步骤幂等：以 `legacy_id_map` 和 deterministic id 识别已迁移记录。
- consistency check 必须覆盖 FK、orphan、重复 default route、缺失 binding、缺失 model route、projection cache 可重建性。

### Phase 1：Runtime Core

1. 新增 `RuntimeOrchestrator`。
2. 新增 `RuntimeSessionStore`、`RuntimeTurnStore`、`RuntimeEventStore`、`RuntimeTraceStore`。
3. 新增 `AgentRegistry`。
4. 新增 `ModelRoutingService`。
5. 新增 `PermissionService`，默认 unrestricted。
6. 新增 `SecretEnvService`。

### Phase 2：Adapters

1. 新增 `AcpxAdapter`。
2. 新增 `MagicAdapter`。
3. 接入 all core/verified agents。
4. 接入 experimental registry。
5. 补图标资产。

### Phase 3：调用点迁移

1. Chat 改为 RuntimeOrchestrator。
2. Agent chat 改为 RuntimeOrchestrator。
3. Workflow manager 改为 RuntimeOrchestrator。
4. Model probes 改为 modelRouteId + RuntimeOrchestrator。
5. Diagnostics 改为 runtime sessions / turns / traces。

### Phase 4：API/UI 切换

1. 新增 `/api/runtime/*`、`/api/agents/*`、`/api/runtime-sessions/*`。
2. `/engines` 页面改为 runtime/agent 管理。
3. Models 页面改为 catalog/routes/probes/benchmarks。
4. Secrets/Env 配置升级。
5. Chat UI 接入 runtime status，不展示 acpx 内部状态。

### Phase 5：删除旧代码

1. 删除旧 wrappers。
2. 删除 SDK dependencies。
3. 删除 `engine-factory`。
4. 删除 `acp-engine` / `acp-wrapper-base`。
5. 删除 SDK/stdio tests。
6. 删除旧 API schema。

## Scripts 迁移

新增：

- `scripts/check-runtime-availability.mjs`
- `scripts/check-runtime-chat.cjs`
- `scripts/check-runtime-session.mjs`
- `scripts/check-runtime-trace.mjs`
- `scripts/check-model-routes.mjs`
- `scripts/check-agent-registry.mjs`

改造：

- `check-engine-chat.cjs` -> 调用 runtime chat。
- `check-engine-availability.mjs` -> 调用 agent availability。
- `check-acp-connectivity.mjs` -> `check-acpx-connectivity.mjs`，仅诊断 acpx adapter。
- workflow/spec/check 脚本参数从 `engine/driver/model` 改为 `agent/modelRoute/profile`。

## 测试迁移

新增测试：

- `runtime-orchestrator.test.ts`
- `runtime-session-store.test.ts`
- `runtime-turn-queue.test.ts`
- `runtime-event-projection.test.ts`
- `runtime-trace-redaction.test.ts`
- `agent-registry.test.ts`
- `model-routing-service.test.ts`
- `model-sqlite-migration.test.ts`
- `secret-env-service.test.ts`
- `permission-service.test.ts`
- `acpx-adapter.test.ts`
- `magic-adapter.test.ts`
- `session-graph-compact-fork.test.ts`

删除或重写：

- `engine-factory-*`
- `engine-driver-resolution`
- `acp-wrapper-base`
- SDK wrapper tests。

端到端：

- codex。
- claude。
- opencode。
- cursor。
- kiro。
- trae。
- nga。
- codegenie。
- cangjie-magic。
- queue/cancel。
- compact/fork。
- model probe。
- benchmark。
- MCP/skills。

## 风险

1. acpx 仍是 alpha，必须 adapter 封装并 pin 版本。
2. acpx runtime API 与 CLI/flow 能力不完全一致。
3. compact/fork 部分 agent 不支持 native，只能 fallback。
4. Usage/cost 上报不稳定。
5. 破坏性 API 会影响现有前端和脚本，需要一次性同步迁移。
6. SQLite migration 必须可回滚。
7. 默认 unrestricted 风险高，但符合当前产品目标；必须清楚展示并允许用户收紧。
8. 全量 agent registry 容易引入未验证能力，必须分层展示。

## 上游 acpx 需求

1. runtime API 暴露 auth credentials / auth policy。
2. runtime API 暴露完整 permission policy。
3. 一等 command invocation。
4. 一等 compact session。
5. 一等 fork session。
6. 标准 model schema。
7. 标准 usage/cost schema，区分 missing 和 zero。
8. agent registry metadata：family、provider、env schema、capabilities、icon hints。
9. MCP runtime status 和动态更新。

## 验收标准

1. 业务调用点不再依赖 `Engine`。
2. 新 runtime session/turn/event/trace 全部写 SQLite。
3. 模型执行使用 `modelRouteId`。
4. 旧 SDK/stdio driver UI 和配置消失。
5. 除 `cangjie-magic` 外，所有 core/verified agent 通过 acpx。
6. `cangjie-magic` 通过 `MagicAdapter` 接入。
7. 权限默认 unrestricted。
8. queue/cancel/compact/fork 可用并可追踪。
9. probes/benchmarks 记录 usage/cost。
10. diagnostics 可导出脱敏 trace 包。
11. 旧 wrapper 和 SDK dependency 被删除。
