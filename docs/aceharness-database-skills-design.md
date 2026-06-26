# ACEHarness 数据库能力 Skills 设计文档

本文档描述如何把 ACEHarness 当前已有的 RAG 向量数据库能力和 SQLite 本地数据库能力，以官方内置 Skills 的形式开放给工作流、Agent 和其他 Skills 使用。

设计目标是：对 AI 来说能力表现为普通 Skill；对系统来说能力仍由 ACEHarness 运行时服务统一授权、审计和隔离，避免 Agent 或第三方 Skill 直接读写系统内部数据库文件。

## 1. 背景与现状

ACEHarness 当前已经有两类本地数据库能力：

1. RAG 向量数据库
   - 当前实现位于 `src/lib/rag/store.ts`。
   - 元数据文件位于运行时数据目录下的 `data/rag/metadata.json`。
   - 向量数据使用 LanceDB，默认路径为 `data/rag/lancedb`。
   - 当前已有 API 包括知识库列表、详情、导入、搜索、行管理等。
   - 本设计中只向工作流和 Skills 开放查询能力，不开放导入、删除、改写 RAG 数据。

2. SQLite 数据库
   - 当前 ACEHarness 自身使用 SQLite 存储工作流事件，例如 `data/workflow-events.sqlite`。
   - opencode 也有自己的 SQLite，例如用户目录下的 `opencode.db`。
   - 这些都是系统或第三方引擎内部数据库，不应直接暴露给 Agent 或 Skill。
   - 本设计新增面向 Skill 的 workspace 内 SQLite 数据库能力，允许创建、删除和 CRUD，但严格限制在当前 workspace 内。

现有 Skills 机制主要是文件和提示词机制：

- 工作流通过 `context.skills` 启用 workflow-level skills。
- Agent 通过自身配置里的 `skills` 启用 agent-level skills。
- 运行时会把 Skills 同步到 workspace 的 `.agents/skills` 或引擎对应目录，并在 prompt 中提示 Agent 阅读 `SKILL.md`。
- Skill 本身目前没有统一的 ACEHarness 后端能力调用通道。

因此本设计不把数据库能力简单写成纯提示词，而是定义“官方能力 Skill + 运行时服务 + CLI 调用面”的组合。

## 2. 设计目标

1. RAG 能力以 `aceharness-rag` Skill 暴露。
2. SQLite 能力以 `aceharness-sqlite` Skill 暴露。
3. 工作流配置中开启 RAG 或 SQLite 能力后，系统自动启用对应 Skill。
4. 其他 Skill 可以通过声明依赖引用这两个官方能力 Skill。
5. RAG 仅支持查询，不支持通过 Skill 写入、导入或删除 RAG 数据。
6. SQLite 支持创建数据库文件、删除数据库文件，以及常规 CRUD。
7. SQLite 文件默认位于当前 workflow/chat workspace 内，不允许访问 ACEHarness 内部数据目录或任意绝对路径。
8. 所有数据库能力调用都必须通过 ACEHarness runtime service，统一做权限校验、路径隔离、参数校验和审计。
9. Agent prompt 中要明确说明当前可用数据库、允许的操作和调用方式。
10. 能力应同时适配工作流和聊天页。本文重点描述工作流，聊天页可复用同一套 runtime service 与 Skill。

## 3. 非目标

1. 不把 `workflow-events.sqlite` 暴露给 Skill 直接读写。
2. 不把 opencode 的 `opencode.db` 暴露给 Skill 直接读写。
3. 不允许 Skill 直接访问 LanceDB 文件路径。
4. 不在第一阶段支持 RAG 写入、导入、删除或重建索引。
5. 不要求所有引擎都原生支持 MCP。CLI 是基础调用面，MCP 可以作为增强。
6. 不允许用户在 workflow 配置里写任意 SQLite 绝对路径。

## 4. 总体架构

建议将数据库能力拆成四层：

1. 配置层
   - 工作流 `context` 声明需要开启哪些数据库能力。
   - Skill frontmatter 声明依赖哪些能力 Skill。

2. Skill 层
   - `aceharness-rag/SKILL.md` 描述 RAG 查询能力、调用命令、返回格式和使用约束。
   - `aceharness-sqlite/SKILL.md` 描述 SQLite CRUD 能力、建表迁移方式、查询和写入规范。

3. Runtime Service 层
   - ACEHarness 后端提供受控 runtime API。
   - API 使用运行时 token、runId、sessionId、workspaceRoot 和 skillName 做授权。
   - 服务内部调用 `src/lib/rag/store.ts` 或受控 SQLite adapter。

4. CLI / MCP 调用层
   - CLI：`aceharness rag ...`、`aceharness sqlite ...`。
   - MCP：可选地暴露 `aceharness_rag_search`、`aceharness_sqlite_query` 等 tools。
   - Skill 优先指导 Agent 使用 CLI，因为 CLI 对所有命令型引擎都更稳定。

数据流如下：

```text
Workflow config
  -> capabilitySkills 配置解析
  -> 自动展开 context.skills
  -> 运行时生成 capability grant
  -> prompt 注入可用数据库说明
  -> Agent 阅读 aceharness-rag / aceharness-sqlite
  -> Agent 调用 CLI 或 MCP
  -> runtime service 校验 token + grant + workspace 路径
  -> RAG / SQLite adapter 执行
  -> 返回结构化 JSON
  -> 调用记录进入 run audit log
```

## 5. 官方 Skills

### 5.1 `aceharness-rag`

`aceharness-rag` 是只读检索 Skill。

职责：

- 告诉 Agent 当前有哪些可查询知识库。
- 告诉 Agent 如何构造查询。
- 告诉 Agent 如何引用返回的 source 信息。
- 明确说明不可写入、不可删除、不可导入 RAG 数据。

建议的 `SKILL.md` 内容结构：

````markdown
---
name: aceharness-rag
description: 使用 ACEHarness 内置 RAG/LanceDB 知识库进行只读检索。
capabilities:
  rag:
    read: true
---

# 使用场景

当任务需要查找项目知识、历史资料、导入文档、外部 RAG bundle 内容时，使用本 Skill。

# 可用命令

使用 CLI：

```bash
aceharness rag search --kb <knowledgeBaseId> --query "<query>" --top-k 8 --json
```

# 返回字段

- id
- knowledgeBaseId
- documentId
- chunkIndex
- text
- sourceTitle
- sourceSystem
- externalId
- metadataJson
- _distance

# 约束

- 只能查询 runtime prompt 中列出的知识库。
- 不允许写入、删除、导入 RAG 数据。
- 回答中引用检索结果时，应说明来源标题或 sourceSystem。
````

### 5.2 `aceharness-sqlite`

`aceharness-sqlite` 是 workspace-scoped SQLite Skill。

职责：

- 告诉 Agent 当前可用的逻辑数据库名。
- 告诉 Agent 数据库文件位于当前 workspace 内。
- 告诉 Agent 如何创建数据库、执行迁移、查询、写入和删除数据库文件。
- 明确说明禁止访问系统内部 SQLite。

建议的 `SKILL.md` 内容结构：

````markdown
---
name: aceharness-sqlite
description: 使用 ACEHarness 运行时提供的 workspace SQLite 能力创建和维护 Skill 数据库。
capabilities:
  sqlite:
    read: true
    write: true
    createDatabase: true
    deleteDatabase: true
---

# 使用场景

当 Skill 需要维护结构化状态、缓存、索引、任务记录、跨步骤数据表时，使用本 Skill。

# 可用命令

```bash
aceharness sqlite list --json
aceharness sqlite create --db <name>
aceharness sqlite migrate --db <name> --file <migration.sql>
aceharness sqlite query --db <name> --sql "SELECT * FROM items WHERE id = ?" --params "[\"id-1\"]" --json
aceharness sqlite exec --db <name> --sql "INSERT INTO items(id, value) VALUES(?, ?)" --params "[\"id-1\", \"value\"]" --json
aceharness sqlite transaction --db <name> --file <commands.json> --json
aceharness sqlite delete-db --db <name>
```

# 约束

- 只能使用 runtime prompt 中列出的逻辑数据库名。
- 数据库文件必须位于当前 workspace 内。
- 不允许 ATTACH / DETACH / load_extension / VACUUM INTO。
- 不允许访问 ACEHarness 内部数据库。
- 所有写操作应可重放或幂等，避免重复执行造成脏数据。
````

## 6. Workflow 配置设计

建议在 workflow `context` 下新增 `capabilitySkills` 字段。

示例：

```yaml
context:
  projectRoot: C:/Users/Shawn/AppData/Roaming/ACEHarness/data/agora-workspaces/example
  workspaceMode: in-place
  skills:
    - aceharness-workflow-creator

  capabilitySkills:
    rag:
      enabled: true
      knowledgeBases:
        - default
      topK: 8
      autoInject: false
      allowAgentQuery: true

    sqlite:
      enabled: true
      root: workspace
      databases:
        - name: workflow-cache
          path: .aceharness/db/workflow-cache.sqlite
          allowCreate: true
          allowDelete: true
          readOnly: false
        - name: skill-state
          path: .aceharness/db/skill-state.sqlite
          allowCreate: true
          allowDelete: false
          readOnly: false
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `capabilitySkills.rag.enabled` | boolean | 是否启用 RAG Skill |
| `capabilitySkills.rag.knowledgeBases` | string[] | 允许查询的知识库 id |
| `capabilitySkills.rag.topK` | number | 默认检索条数 |
| `capabilitySkills.rag.autoInject` | boolean | 是否在每个 step/state 执行前自动检索并注入上下文 |
| `capabilitySkills.rag.allowAgentQuery` | boolean | 是否允许 Agent 主动调用 RAG 查询 |
| `capabilitySkills.sqlite.enabled` | boolean | 是否启用 SQLite Skill |
| `capabilitySkills.sqlite.root` | `"workspace"` | 数据库根目录策略，首期只支持 workspace |
| `capabilitySkills.sqlite.databases[].name` | string | 逻辑数据库名 |
| `capabilitySkills.sqlite.databases[].path` | string | workspace 内相对路径 |
| `capabilitySkills.sqlite.databases[].allowCreate` | boolean | 是否允许创建数据库 |
| `capabilitySkills.sqlite.databases[].allowDelete` | boolean | 是否允许删除数据库文件 |
| `capabilitySkills.sqlite.databases[].readOnly` | boolean | 是否只读 |

### 6.1 自动展开 Skills

运行时解析 workflow config 后，应执行能力 Skill 展开：

```ts
effectiveSkills = [
  ...context.skills,
  ...(context.capabilitySkills?.rag?.enabled ? ['aceharness-rag'] : []),
  ...(context.capabilitySkills?.sqlite?.enabled ? ['aceharness-sqlite'] : []),
  ...skillsRequiredByEnabledSkills,
]
```

展开后的 Skill 应参与：

- workspace `.agents/skills` 同步。
- prompt 中“必须使用的 Skills”列表。
- Skill 内容去重加载。
- 运行时权限 grant 生成。

### 6.2 与 Agent Skills 的关系

`context.capabilitySkills` 表示 workflow 授权。

Agent 的 `skills` 表示该 Agent 明确需要读取或执行哪些 Skill 指令。

推荐策略：

- 如果 workflow 开启了 RAG，则所有 Agent 都可看到 `aceharness-rag` 的可用性提示。
- 是否把完整 `aceharness-rag/SKILL.md` 注入给每个 Agent，可沿用现有 skill prompt 去重策略。
- 如果某个 Agent 或第三方 Skill 声明依赖 `aceharness-rag`，则必须注入完整 Skill 说明。
- SQLite 同理，但 prompt 中应只列出允许的数据库，不展示内部 token。

## 7. Skill 依赖声明

第三方或用户自定义 Skill 可以声明依赖官方能力 Skill。

示例：

```yaml
---
name: project-fact-cache
description: 读取项目材料并把结构化事实缓存到 SQLite。
requires:
  skills:
    - aceharness-rag
    - aceharness-sqlite
---
```

运行时处理规则：

1. 发现启用的 Skill 声明 `requires.skills`。
2. 将依赖 Skill 加入 `effectiveSkills`。
3. 如果依赖的是 `aceharness-rag`，但 workflow 未开启 `capabilitySkills.rag.enabled`：
   - 不授予 RAG runtime grant。
   - prompt 中提示该依赖未授权。
   - CLI 调用会返回权限错误。
4. 如果依赖的是 `aceharness-sqlite`，但 workflow 未开启 `capabilitySkills.sqlite.enabled`：
   - 不授予 SQLite runtime grant。
   - prompt 和 CLI 行为同上。
5. 依赖展开需要防循环。

这样可以让其他 Skill 通过引用官方 Skill 使用能力，但最终权限仍由 workflow 配置控制。

## 8. Prompt 注入设计

启用能力后，prompt 中增加一个稳定 section，例如：

```text
# ACEHarness 数据库能力

当前运行启用了以下官方数据库 Skills。需要使用时，请阅读对应 SKILL.md，并优先通过 aceharness CLI 调用。

## aceharness-rag

状态：已启用
可查询知识库：
- default：ACEHarness 默认 RAG 数据库

默认 topK：8
限制：仅支持查询，不支持导入、写入、删除 RAG 数据。
Skill 文件：<runtime-skills-dir>/aceharness-rag/SKILL.md

## aceharness-sqlite

状态：已启用
数据库根目录：当前 workspace
可用数据库：
- workflow-cache -> .aceharness/db/workflow-cache.sqlite
  - allowCreate: true
  - allowDelete: true
  - readOnly: false

限制：只能访问列出的逻辑数据库；不能访问 ACEHarness 内部 SQLite；不能使用 ATTACH/DETACH/load_extension/VACUUM INTO。
Skill 文件：<runtime-skills-dir>/aceharness-sqlite/SKILL.md
```

如果某能力未开启，但某 Skill 声明了依赖，应注入警告：

```text
# 未授权 Skill 依赖

以下 Skill 依赖数据库能力，但当前 workflow 未开启对应 capabilitySkills：
- project-fact-cache 需要 aceharness-sqlite

不要调用未授权能力；相关 CLI 命令会失败。
```

## 9. Runtime Service 设计

Runtime Service 是数据库能力的唯一执行入口。

### 9.1 鉴权上下文

每次 workflow/chat run 启动时生成 runtime grant：

```ts
interface RuntimeDatabaseGrant {
  runId?: string;
  chatSessionId?: string;
  workflowConfigFile?: string;
  workspaceRoot: string;
  enabledSkills: string[];
  rag?: {
    enabled: boolean;
    knowledgeBases: string[];
    topK: number;
    allowAgentQuery: boolean;
  };
  sqlite?: {
    enabled: boolean;
    databases: Array<{
      name: string;
      absolutePath: string;
      relativePath: string;
      allowCreate: boolean;
      allowDelete: boolean;
      readOnly: boolean;
    }>;
  };
}
```

CLI 或 MCP 调用时携带：

- runtime token
- runId 或 chatSessionId
- skillName
- toolName
- request payload

服务端根据 token 找到 grant，校验：

- 当前 run/session 是否存在。
- skill 是否在 `enabledSkills` 中。
- skill 是否允许使用目标能力。
- 目标 RAG knowledgeBase 是否在白名单。
- SQLite 逻辑数据库名是否在白名单。
- SQLite 路径是否仍位于 workspace 内。

### 9.2 RAG API

RAG runtime API 只读。

#### `GET /api/runtime/rag/knowledge-bases`

返回当前 grant 允许查询的知识库。

响应：

```json
{
  "knowledgeBases": [
    {
      "id": "default",
      "name": "ACEHarness 默认 RAG 数据库",
      "description": "内置 LanceDB 向量数据库",
      "documentCount": 2,
      "chunkCount": 4,
      "embeddingModel": "local-hash-384"
    }
  ]
}
```

#### `POST /api/runtime/rag/search`

请求：

```json
{
  "knowledgeBaseId": "default",
  "query": "状态机工作流中的 judge 怎么设计？",
  "topK": 8
}
```

响应：

```json
{
  "results": [
    {
      "id": "chunk-id",
      "knowledgeBaseId": "default",
      "documentId": "doc-id",
      "chunkIndex": 0,
      "text": "...",
      "sourceTitle": "title",
      "sourceSystem": "lancedb/vectordb-recipes",
      "externalId": "external-id",
      "metadataJson": "{}",
      "_distance": 0.12
    }
  ]
}
```

错误：

- `403 RAG_CAPABILITY_DISABLED`
- `403 RAG_KNOWLEDGE_BASE_NOT_ALLOWED`
- `400 RAG_QUERY_EMPTY`
- `500 RAG_SEARCH_FAILED`

### 9.3 SQLite API

SQLite runtime API 支持数据库文件生命周期和 CRUD。

#### `GET /api/runtime/sqlite/databases`

返回当前 grant 允许访问的逻辑数据库。

#### `POST /api/runtime/sqlite/databases`

创建数据库文件。

请求：

```json
{
  "name": "workflow-cache"
}
```

规则：

- `name` 必须已在 grant 中声明。
- `allowCreate` 必须为 true。
- 父目录不存在时可自动创建。
- 创建后可执行基础 PRAGMA：
  - `PRAGMA journal_mode = WAL`
  - `PRAGMA synchronous = NORMAL`
  - `PRAGMA foreign_keys = ON`

#### `DELETE /api/runtime/sqlite/databases/{name}`

删除数据库文件。

规则：

- `allowDelete` 必须为 true。
- 只删除配置对应路径及其 WAL/SHM 文件：
  - `db.sqlite`
  - `db.sqlite-wal`
  - `db.sqlite-shm`
- 不允许删除目录。
- 不允许删除未声明的文件。

#### `POST /api/runtime/sqlite/query`

只读查询。

请求：

```json
{
  "database": "workflow-cache",
  "sql": "SELECT id, value FROM items WHERE id = ?",
  "params": ["item-1"],
  "limit": 200
}
```

响应：

```json
{
  "rows": [
    { "id": "item-1", "value": "..." }
  ],
  "rowCount": 1
}
```

#### `POST /api/runtime/sqlite/exec`

写操作。

请求：

```json
{
  "database": "workflow-cache",
  "sql": "INSERT INTO items(id, value) VALUES(?, ?)",
  "params": ["item-1", "value"]
}
```

响应：

```json
{
  "changes": 1,
  "lastInsertRowid": 1
}
```

#### `POST /api/runtime/sqlite/transaction`

事务执行。

请求：

```json
{
  "database": "workflow-cache",
  "statements": [
    {
      "sql": "CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, value TEXT NOT NULL)",
      "params": []
    },
    {
      "sql": "INSERT OR REPLACE INTO items(id, value) VALUES(?, ?)",
      "params": ["item-1", "value"]
    }
  ]
}
```

响应：

```json
{
  "results": [
    { "changes": 0 },
    { "changes": 1, "lastInsertRowid": 1 }
  ]
}
```

### 9.4 SQLite SQL 安全限制

禁止以下语句或关键字：

- `ATTACH`
- `DETACH`
- `load_extension`
- `VACUUM INTO`
- `.read`
- `.shell`
- `PRAGMA writable_schema`
- 多语句拼接中的隐藏危险语句

建议策略：

1. `query` 只允许单条 `SELECT` 或 `WITH ... SELECT`。
2. `exec` 允许：
   - `CREATE TABLE`
   - `CREATE INDEX`
   - `DROP TABLE`
   - `ALTER TABLE`
   - `INSERT`
   - `UPDATE`
   - `DELETE`
   - `REPLACE`
   - 受控 `PRAGMA`，例如 `foreign_keys`
3. `transaction` 每条语句都执行同样校验。
4. 参数必须通过 `params` 绑定，不鼓励 Agent 拼接用户输入。
5. 返回结果要有 row limit，默认 200，最大 1000。

## 10. CLI 设计

CLI 是 Skills 默认推荐的调用方式。

### 10.1 RAG CLI

```bash
aceharness rag list --json
aceharness rag search --kb default --query "状态机 judge 设计" --top-k 8 --json
```

输出示例：

```json
{
  "results": [
    {
      "text": "...",
      "sourceTitle": "...",
      "sourceSystem": "...",
      "_distance": 0.12
    }
  ]
}
```

### 10.2 SQLite CLI

```bash
aceharness sqlite list --json
aceharness sqlite create --db workflow-cache --json
aceharness sqlite query --db workflow-cache --sql "SELECT * FROM items LIMIT ?" --params "[10]" --json
aceharness sqlite exec --db workflow-cache --sql "INSERT INTO items(id, value) VALUES(?, ?)" --params "[\"a\", \"b\"]" --json
aceharness sqlite transaction --db workflow-cache --file .aceharness/sqlite/init.json --json
aceharness sqlite delete-db --db workflow-cache --json
```

CLI 运行时从环境变量读取：

- `ACEHARNESS_RUNTIME_URL`
- `ACEHARNESS_RUNTIME_TOKEN`
- `ACEHARNESS_RUN_ID`
- `ACEHARNESS_CHAT_SESSION_ID`
- `ACEHARNESS_SKILL_NAME`

这些变量由 ACEHarness 在 workflow/chat 执行环境中注入，不写入仓库。

## 11. MCP Tool 设计

MCP 是增强能力，不作为首期唯一调用面。

可选 tools：

- `aceharness_rag_list`
- `aceharness_rag_search`
- `aceharness_sqlite_list`
- `aceharness_sqlite_create_database`
- `aceharness_sqlite_delete_database`
- `aceharness_sqlite_query`
- `aceharness_sqlite_exec`
- `aceharness_sqlite_transaction`

MCP tool 和 CLI 调用同一套 runtime service，权限模型完全一致。

## 12. SQLite 文件路径策略

SQLite 首期只支持 workspace 内路径。

路径解析规则：

1. 输入路径必须是相对路径。
2. 使用 `path.resolve(workspaceRoot, relativePath)` 得到绝对路径。
3. 再校验绝对路径必须位于 `workspaceRoot` 下。
4. 只允许后缀：
   - `.sqlite`
   - `.sqlite3`
   - `.db`
5. 推荐默认目录：
   - `.aceharness/db/`
6. 删除数据库时，只允许删除数据库文件及同名 WAL/SHM。

示例：

```yaml
databases:
  - name: workflow-cache
    path: .aceharness/db/workflow-cache.sqlite
```

不允许：

```yaml
path: C:/Users/Shawn/AppData/Roaming/ACEHarness/data/workflow-events.sqlite
path: ../../outside.sqlite
path: /tmp/global.sqlite
```

## 13. 工作流运行时接入点

阶段式 workflow manager 和状态机 workflow manager 都需要接入。

### 13.1 准备阶段

在 workflow start/resume 前：

1. 读取 config。
2. 解析 `context.capabilitySkills`。
3. 展开 `context.skills`。
4. 创建 runtime grant。
5. 同步 `aceharness-rag` 和 `aceharness-sqlite` 到 runtime skills 目录。
6. 在 workspace 中准备 SQLite 父目录，但不一定立即创建数据库文件。

### 13.2 Prompt 构建阶段

阶段式：

- 在 `buildStepPrompt` 或现有技能 prompt section 附近注入数据库能力说明。

状态机：

- 在 `buildStepContext` 或现有 `# 必须使用的 Skills` section 附近注入数据库能力说明。

要求：

- 每个 Agent prompt 只注入一次通用规则。
- 当前 step/state 可以重复注入当前可用数据库摘要。
- 不注入 runtime token。

### 13.3 执行环境阶段

执行 Agent 命令时，给进程环境注入：

```text
ACEHARNESS_RUNTIME_URL
ACEHARNESS_RUNTIME_TOKEN
ACEHARNESS_RUN_ID
ACEHARNESS_CHAT_SESSION_ID
ACEHARNESS_WORKSPACE_ROOT
ACEHARNESS_SKILL_NAME
```

如果当前调用不是某个 Skill 发起，可以让 `ACEHARNESS_SKILL_NAME` 为空，但 runtime service 仍按 run grant 校验。

## 14. 审计与可观测性

所有 runtime database 调用都应写审计记录。

审计字段：

```ts
interface DatabaseCapabilityAuditRecord {
  id: string;
  timestamp: string;
  runId?: string;
  chatSessionId?: string;
  workflowConfigFile?: string;
  skillName?: string;
  agentName?: string;
  capability: 'rag' | 'sqlite';
  operation: string;
  target: string;
  status: 'success' | 'error';
  durationMs: number;
  inputSummary: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  error?: string;
}
```

RAG 审计示例：

- operation: `search`
- target: `default`
- inputSummary: `{ queryPreview, topK }`
- outputSummary: `{ resultCount }`

SQLite 审计示例：

- operation: `query` / `exec` / `transaction` / `create-db` / `delete-db`
- target: `workflow-cache`
- inputSummary: `{ sqlKind, paramCount }`
- outputSummary: `{ rowCount, changes }`

不建议默认记录完整 SQL 参数值，因为可能包含敏感数据。可以在 debug 模式下开启完整记录。

## 15. UI 设计

工作流设置页新增“数据库能力”区域。

### 15.1 RAG 设置

控件：

- 开关：启用 RAG Skill。
- 知识库多选：选择可查询 knowledge base。
- 默认 topK 数字输入。
- 开关：允许 Agent 主动查询。
- 开关：自动检索并注入上下文。

说明：

- RAG 首期只读。
- 查询来源于 ACEHarness 原生 RAG / LanceDB。

### 15.2 SQLite 设置

控件：

- 开关：启用 SQLite Skill。
- 数据库列表：
  - name
  - path
  - allowCreate
  - allowDelete
  - readOnly
- 添加数据库。
- 删除数据库配置。

表单校验：

- name 只能包含字母、数字、下划线、短横线。
- path 必须是 workspace 内相对路径。
- 后缀必须是 `.sqlite` / `.sqlite3` / `.db`。

### 15.3 运行页

运行页可展示：

- 已启用数据库 Skills。
- RAG 查询次数。
- SQLite query/exec 次数。
- 最近错误。
- 可选查看审计日志。

## 16. 与聊天页的关系

聊天页可以复用同一能力模型。

聊天 session 创建时，可在 session runtime 配置中记录：

```json
{
  "capabilitySkills": {
    "rag": {
      "enabled": true,
      "knowledgeBases": ["default"]
    },
    "sqlite": {
      "enabled": true,
      "databases": [
        {
          "name": "chat-cache",
          "path": ".aceharness/db/chat-cache.sqlite"
        }
      ]
    }
  }
}
```

聊天页的 workspace 选择必须与 SQLite workspace root 一致。用户切换 workspace 时：

- 新请求使用新 workspace grant。
- 旧 session 已创建的数据库仍留在旧 workspace。
- 如果恢复旧 session，应恢复当时绑定的 workspaceRoot。

## 17. 兼容性与迁移

1. 现有 `context.skills` 不变。
2. 未配置 `capabilitySkills` 时行为完全不变。
3. 旧 RAG `store.json` 不参与新能力。
4. 新增 `aceharness-rag` 和 `aceharness-sqlite` 为内置 Skills。
5. 如果用户手动把 `aceharness-rag` 加入 `context.skills` 但未配置 `capabilitySkills.rag.enabled`：
   - Skill 文件可以被读取。
   - runtime 调用返回未授权。
   - prompt 中提示“Skill 已启用但能力未授权”。
6. 如果配置了 `capabilitySkills.rag.enabled` 但 `context.skills` 未写 `aceharness-rag`：
   - 系统自动加入。
7. SQLite 同理。

## 18. 错误处理

错误码建议：

| 错误码 | 含义 |
| --- | --- |
| `RUNTIME_TOKEN_MISSING` | 缺少 runtime token |
| `RUNTIME_TOKEN_INVALID` | token 无效或过期 |
| `CAPABILITY_NOT_GRANTED` | 当前 run/session 未授权该能力 |
| `SKILL_NOT_ALLOWED` | 当前 Skill 未启用或未声明依赖 |
| `RAG_DISABLED` | RAG 能力未开启 |
| `RAG_KB_NOT_ALLOWED` | 知识库不在授权列表 |
| `RAG_QUERY_EMPTY` | 查询为空 |
| `SQLITE_DISABLED` | SQLite 能力未开启 |
| `SQLITE_DB_NOT_ALLOWED` | 数据库逻辑名未授权 |
| `SQLITE_CREATE_NOT_ALLOWED` | 不允许创建数据库 |
| `SQLITE_DELETE_NOT_ALLOWED` | 不允许删除数据库 |
| `SQLITE_READONLY` | 只读数据库不允许写入 |
| `SQLITE_PATH_ESCAPE` | 数据库路径逃逸 workspace |
| `SQLITE_UNSAFE_SQL` | SQL 包含禁止语句 |
| `SQLITE_QUERY_FAILED` | SQLite 执行失败 |

Agent prompt 中应指导：

- 权限错误不要反复重试。
- SQL 错误应先检查 schema。
- RAG 无结果时应如实说明无匹配结果。

## 19. 测试计划

### 19.1 单元测试

RAG：

- workflow 开启 RAG 后自动加入 `aceharness-rag`。
- 未授权 knowledgeBase 查询失败。
- RAG search 返回 rowsToChunks 格式。
- RAG 不提供写接口。

SQLite：

- 数据库路径必须在 workspace 内。
- 创建数据库成功。
- 删除数据库只删除 db/wal/shm。
- readOnly 数据库拒绝 exec。
- 禁止 ATTACH / DETACH / load_extension / VACUUM INTO。
- query 只允许 SELECT。
- transaction 中任一危险语句导致整个事务拒绝。

Skill 依赖：

- Skill 声明 `requires.skills` 后自动展开依赖。
- 未开启 capability 时依赖 Skill 可见但 runtime 调用失败。
- 依赖循环不会死循环。

### 19.2 集成测试

- 阶段式 workflow 开启 RAG，Agent prompt 包含 `aceharness-rag` 和可用 KB。
- 状态机 workflow 开启 SQLite，Agent prompt 包含可用数据库。
- CLI 使用 runtime token 成功调用 RAG。
- CLI 使用 runtime token 成功创建 SQLite、建表、插入、查询、删除。
- workspace 切换后 SQLite 路径随 workspace 改变。
- isolated-copy workflow 中 SQLite 默认写入隔离 workspace，而不是原始项目目录。

### 19.3 安全测试

- SQLite path `../../outside.sqlite` 被拒绝。
- SQLite path 绝对路径被拒绝。
- 删除未声明数据库被拒绝。
- 查询 ACEHarness 内部 `workflow-events.sqlite` 被拒绝。
- RAG 查询未授权 KB 被拒绝。
- 无 token 调用 runtime API 被拒绝。

## 20. 实现阶段建议

### 阶段 1：官方 Skills 与配置解析

- 新增 `skills/aceharness-rag/SKILL.md`。
- 新增 `skills/aceharness-sqlite/SKILL.md`。
- schema 增加 `context.capabilitySkills`。
- workflow runtime 自动展开 capability skills。
- prompt 注入可用数据库说明。

验收：

- 工作流配置开启 RAG/SQLite 后，Agent prompt 中可见对应 Skill 和能力说明。

### 阶段 2：RAG Runtime Service 与 CLI

- 新增 runtime grant。
- 新增 `/api/runtime/rag/knowledge-bases`。
- 新增 `/api/runtime/rag/search`。
- 新增 `aceharness rag list/search` CLI。
- 写审计日志。

验收：

- Agent 能通过 CLI 查询 `default` RAG。
- 未授权 KB 查询失败。

### 阶段 3：SQLite Runtime Service 与 CLI

- 新增 SQLite adapter。
- 新增数据库路径解析和安全校验。
- 新增 create/delete/query/exec/transaction API。
- 新增 `aceharness sqlite ...` CLI。
- 写审计日志。

验收：

- Agent 能在 workspace 内创建 SQLite、建表、插入、查询和删除数据库。
- 路径逃逸和危险 SQL 被拒绝。

### 阶段 4：Skill 依赖展开

- 解析 Skill frontmatter 的 `requires.skills`。
- 自动展开官方能力 Skill。
- 未授权依赖提示。

验收：

- 第三方 Skill 依赖 `aceharness-sqlite` 时，开启 workflow SQLite 后可直接使用。
- 未开启时 prompt 和 runtime 都明确拒绝。

### 阶段 5：UI 与运行日志

- 工作流设置页新增数据库能力配置。
- 运行页展示数据库能力状态和调用统计。
- 审计日志可查看。

验收：

- 用户无需手写 YAML 即可开启 RAG/SQLite 能力。
- 运行结束后可以看到 RAG/SQLite 调用概览。

## 21. 推荐默认值

RAG：

```yaml
rag:
  enabled: false
  knowledgeBases:
    - default
  topK: 8
  autoInject: false
  allowAgentQuery: true
```

SQLite：

```yaml
sqlite:
  enabled: false
  root: workspace
  databases:
    - name: workflow-cache
      path: .aceharness/db/workflow-cache.sqlite
      allowCreate: true
      allowDelete: true
      readOnly: false
```

推荐 UI 文案：

- RAG：`允许 Agent 查询 ACEHarness RAG 知识库`
- SQLite：`允许 Skills 在当前工作区内创建和使用 SQLite 数据库`

## 22. 关键取舍

1. 为什么能力做成 Skill
   - 符合用户心智：开启 Skill 后，AI 知道如何使用。
   - 便于其他 Skill 依赖复用。
   - prompt、文件同步和工作流 UI 都能复用现有体系。

2. 为什么还需要 runtime service
   - 纯 Skill 无法安全访问 ACEHarness 后端能力。
   - RAG 和 SQLite 都需要权限、路径隔离和审计。
   - runtime service 是唯一可信执行边界。

3. 为什么 RAG 只读
   - RAG 是全局知识资产，写入/删除影响面大。
   - 查询能力足够支撑多数 workflow 推理场景。
   - 写入能力可以后续作为单独权限设计。

4. 为什么 SQLite 放 workspace 内
   - SQLite 是 Skill 的工作数据和缓存，不应污染 ACEHarness 内部数据目录。
   - workspace 绑定后，运行结果可追踪、可备份、可随项目迁移。
   - isolated-copy 模式下天然隔离，减少破坏原项目的风险。

5. 为什么不直接开放系统 SQLite
   - `workflow-events.sqlite` 是系统事件库，误写会破坏运行历史。
   - opencode SQLite 属于第三方引擎内部状态。
   - Skill 数据库应是明确声明、可删除、可迁移的独立文件。

## 23. 最终形态

用户在工作流里打开数据库能力后：

1. 系统自动启用 `aceharness-rag` / `aceharness-sqlite`。
2. Agent prompt 明确看到可用数据库和限制。
3. Agent 或其他 Skill 按 `SKILL.md` 调用 CLI。
4. CLI 调用 ACEHarness runtime service。
5. runtime service 做权限校验、路径隔离和审计。
6. RAG 查询走现有 LanceDB store。
7. SQLite CRUD 只作用于 workspace 内声明过的数据库文件。

这样既保留了“能力就是 Skill”的使用体验，也保留了数据库操作必须受控的工程边界。
