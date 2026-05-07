# 基于 ACP 的 Code Agent 对接 — 能力约定与验证规范

本文面向 **以 ACP（Agent Client Protocol）方式接入宿主平台的 code agent 提供方**，规定接入须满足的协议能力、行为约束、以及对接方需自行完成的 **强制验证范围**。

> **SDK**：以与宿主平台 **书面约定的 `@agentclientprotocol/sdk` 版本** 为准；接入与验证须使用其导出的 `PROTOCOL_VERSION`、`ClientSideConnection`、`ndJsonStream`。版本号在集成说明中给出。

> **关键词**：本文中 **"必须 / 须 / 应"** 表示接入硬性要求；本文列出的验证项 **全部为必测**，缺一即视为接入不通过。

---

## 1. 总览：宿主侧 ACP 模型（约定）

| 维度 | 约定行为 |
|------|----------|
| 传输 | 子进程 **stdin/stdout**，经 `ndJsonStream` 进行 **NDJSON** 双向流通信；**不接受** 仅以独立 HTTP 端口替代 stdio 协议的实现 |
| 角色 | 宿主作为 **Client**（`ClientSideConnection`），Agent 作为子进程对端 |
| 权限 | 宿主对 `requestPermission` **自动选择 `options[0].optionId`**（近似 always allow） |
| MCP | `newSession` / `loadSession` 中 **`mcpServers` 默认为空数组 `[]`**；如需注入，须在集成说明中显式约定 |
| 超时 | `initialize`、`newSession` 等步骤在宿主侧设有上限；具体阈值在集成说明中给出，验证须在阈值内完成 |
| 系统提示 | 宿主仅在 `session/prompt` 中下发用户文本，**不会**额外传 system 字段；如 Agent 强依赖 system，须自行处理或与宿主单独约定 |

启动 Agent 后若 **stdout 长时间无 NDJSON 协议输出**，会直接表现为 `connection.initialize` 失败/超时，**视为接入不通过**。

---

## 2. 版本与协议握手

### 2.1 协议版本

- 调用 `initialize` 须使用 SDK 导出的 **`PROTOCOL_VERSION`**，**禁止** 硬编码版本号。
- Agent 须在握手阶段与该版本协商成功。

### 2.2 `initialize` 请求体（形状）

字段与 SDK 类型一致。结构示例（`protocolVersion` 为运行时值，`clientInfo` 以宿主实际发送为准）：

```json
{
  "protocolVersion": "<PROTOCOL_VERSION 运行时值>",
  "clientInfo": { "name": "<宿主约定>", "version": "<版本>" },
  "clientCapabilities": {
    "fs": { "readTextFile": true, "writeTextFile": true },
    "terminal": true
  }
}
```

**通过判据**：`initialize` 在宿主超时阈值内返回合法响应；阻塞或超时即不通过。

---

## 3. Client 侧调用顺序

验证程序须按下列顺序覆盖。

1. 启动子进程（命令、工作目录、环境变量以集成说明为准）。
2. `connection.initialize(...)`。
3. 如集成说明要求认证扩展，于 `initialize` 之后调用 `authenticate(...)`，`methodId` 与失败语义按集成说明执行。
4. `connection.newSession({ cwd, mcpServers: [] })`。
5. `connection.unstable_setSessionModel({ sessionId, modelId })` — 选模能力必须支持。
6. `loadSession({ sessionId, cwd, mcpServers: [] })` — 会话续聊能力必须支持。
7. `connection.prompt({ sessionId, prompt: [{ type: 'text', text: <用户输入> }] })`。
8. `connection.cancel({ sessionId })` — 取消能力必须支持。

---

## 4. 子进程启动参数

具体启动参数（可执行文件、子命令、`--cwd` 与 `spawn` 的 `cwd` 一致性、必要环境变量、认证变量）由 **对接双方在集成说明中固化**。

本地与 CI 验证须使用 **与线上一致** 的启动方式；如线上启动方式与验证不一致，验证结果不予认可。

---

## 5. 客户端回调（Agent → Client）

宿主侧 Client 行为如下，验证程序须模拟一致：

| 方法 | 行为 |
|------|------|
| `requestPermission` | 返回 `{ outcome: { outcome: 'selected', optionId: <options[0].optionId 或 'always'> } }` |
| `sessionUpdate` | 处理 `params.update`，驱动可见输出与日志（见第 6 节） |
| `extMethod` / `extNotification` | 按 SDK 定义；未约定的扩展方法返回空对象或忽略，不应抛错断流 |

**人工审批工具**：宿主默认不提供人工审批；若 Agent 必须人工确认才能执行工具，须在集成说明中单独约定方案，否则视为不通过。

---

## 6. `sessionUpdate` 与可见输出

宿主消费下列 `sessionUpdate` 类型：

- `user_message_chunk`
- `agent_message_chunk` — **主可见文本流**
- `agent_thought_chunk`
- `tool_call` / `tool_call_update`
- `plan`
- `current_mode_update`
- `config_option_update`
- 其他类型按 SDK 定义透传

**通过判据**：一次正常对话中须通过 **`agent_message_chunk`** 推送可见正文；若产品形态明确仅展示 thought / 工具链，须在集成说明中显式声明并保留对应类型的稳定输出。

---

## 7. 模型列表与 `unstable_setSessionModel`

- 列表来源：`newSession` / `loadSession` 响应中的 **`models.availableModels`**（见 SDK 类型 `SessionModelState`），**须返回非空列表**。
- **`unstable_setSessionModel`** 须在传入合法 `modelId` 时生效，并在后续 `prompt` 中按所选模型工作；非法 `modelId` 须返回明确错误。

---

## 8. `prompt` 与结果判定

典型请求形状：

```json
{
  "sessionId": "<uuid>",
  "prompt": [{ "type": "text", "text": "<用户输入字符串>" }]
}
```

**成功判据**：`stopReason` 为空或 `end_turn`，且本轮已通过 `sessionUpdate` 推送过可见输出（参见第 6 节）。其他 `stopReason` 须按 SDK 与集成说明给出明确语义。

**连接关闭**：若在已推送非空可见输出后连接被关闭（如 Agent 主动结束），不应视为协议失败；但 Agent 不得在 **未推送任何输出前** 关闭连接。

### 8.1 稳定性与边界（必测）

| 主题 | 通过标准 |
|------|----------|
| 多轮对话 | 同一 `sessionId` 下 **连续 ≥2 次** `prompt` 均成功（每轮均按第 6 节推送可见输出，状态不串扰） |
| 二次冷启动 | 子进程 **退出后重新 spawn** → 完整跑一遍 `initialize` → `newSession` → `prompt`，结果与首次一致 |
| 首次增量延迟 | `prompt` 发出后，须在集成说明中给出的 **首字节延迟阈值** 内出现首个 `sessionUpdate`（`agent_thought_chunk` / `agent_message_chunk` / `tool_call` 任一） |
| 输入长度 | 至少覆盖 **极短**、**中等长度** 两种用户输入 |
| 字符集 | 至少覆盖 **中文** 与常见标点；不得出现编码错位、截断、丢字 |
| 长输入上限 | 在集成说明上限内的长输入须能完整处理，不得静默截断或挂起 |
| 并发约束 | 同一 `sessionId` 上 **不并发** 多个 `prompt`；如收到并发请求，须按 SDK 定义返回明确错误，不得僵死或交叉污染 |

### 8.2 取消与中断（必测）

- 调用 `cancel` 后，对应 `prompt` 须在合理时间内 resolve（按 SDK 语义返回 cancelled 或等价 `stopReason`），**不得永久挂起**。
- 取消后会话仍可继续：随后再发 `prompt` 须能正常工作。
- 子进程被宿主 `kill` 后，下一次重启须从干净状态开始：**不得**遗留锁文件、socket、僵尸子进程影响下次握手。

### 8.3 失败路径与可观测性（必测）

- 协议错误须以 **JSON-RPC / SDK 标准错误** 返回（含 `code`、`message`），禁止以"沉默 + 占满超时"代替错误。
- 无效 `sessionId`、未初始化即 `prompt`、未知方法等异常路径，须返回明确错误。
- **stdout 仅承载 NDJSON 协议帧**；调试日志、警告、堆栈一律走 **stderr**。任何非协议字节出现在 stdout 即不通过。
- 进程异常退出须返回 **非零退出码**，并在 stderr 给出可定位信息。
- **禁止** 将 API Key、Token 等机密打印到 stdout / stderr；日志须脱敏。

### 8.4 能力声明一致

`initialize` 中宿主声明的 `clientCapabilities`（如 `fs`、`terminal`）：Agent 若需访问宿主侧文件或终端，须按协议发起对应的 Agent→Client 请求；不支持的能力须在集成说明中写明限制与降级行为，**禁止** 出现"声明可用但调用挂起/无响应"。

### 8.5 运行环境与依赖（必交付）

对接方须随 Agent 提供并保持更新：

- 必需的 API Key、Token、网络出站域名/端口；
- Agent CLI 的 **最低版本号** 与 **推荐版本号**；
- 验证使用的 **`@agentclientprotocol/sdk` 版本**；
- 已知不支持的环境（离线、纯内网、特定 OS / 架构等）；
- 是否依赖外部账号体系（SSO、OAuth 回调等）。

集成说明、实测环境、本节交付物须三方一致；任一不一致视为接入不通过。

---

## 9. 官方协议文档

- [Agent Client Protocol 概览](https://agentclientprotocol.com/protocol/overview#communication-model)
- [Initialization](https://agentclientprotocol.com/protocol/initialization)
- [Session Setup](https://agentclientprotocol.com/protocol/session-setup)

---

## 10. 对接方自研验证：必须覆盖的范围与写法指引

由 **对接方自行编写并维护** 验证程序（语言不限；Node/TS 下推荐直接使用 `@agentclientprotocol/sdk`，与宿主同栈以减少差异）。

### 10.1 验证项与通过标准（全部必须通过）

| 序号 | 验证项 | 通过标准 |
|------|--------|----------|
| 1 | 传输 | 子进程 stdin/stdout 经 `ndJsonStream`（或等价 NDJSON 双向流）连接 `ClientSideConnection` 成功 |
| 2 | 握手 | `initialize` 使用 `PROTOCOL_VERSION`，`clientCapabilities` 与集成说明一致；在阈值内返回 |
| 3 | 会话创建 | `newSession`（`cwd`、`mcpServers` 按约定）返回有效 `sessionId`，在阈值内完成 |
| 4 | 单轮对话 | `prompt` 调用 resolve；`stopReason` 与第 8 节一致 |
| 5 | 流式输出 | `sessionUpdate` 至少出现一次 `agent_message_chunk`（或集成说明声明的等价类型） |
| 6 | 权限 | `requestPermission` 客户端按第 5 节自动选第一项；本轮触发工具时工具链须能完整结束 |
| 7 | 多轮稳定 | 同一 session 连续 ≥2 轮 `prompt` 全部成功，无状态串扰 |
| 8 | 二次冷启动 | 子进程退出后重启，重新走完整链路，结果与首次一致 |
| 9 | 首字节延迟 | `prompt` 后首个 `sessionUpdate` 在集成说明阈值内到达 |
| 10 | 输入边界 | 短句、中等长度、中文 / 常见标点、集成说明上限内的长输入，全部通过 |
| 11 | 并发约束 | 同 session 并发 `prompt` 行为符合 SDK 定义（明确错误而非僵死） |
| 12 | 失败可观测 | 协议错误带标准 `code`/`message`；非协议日志不进 stdout；异常退出码非零 |
| 13 | 安全 | 机密信息不进 stdout / stderr，日志脱敏 |
| 14 | 能力一致 | `initialize` 声明的能力与实际 Agent→Client 行为一致 |
| 15 | 环境与版本 | 第 8.5 节交付物齐全且与实测一致 |
| 16 | 选模 | `availableModels` 非空；`unstable_setSessionModel` 在合法 `modelId` 时生效，非法时返回明确错误 |
| 17 | 续聊 | `loadSession` 恢复指定 `sessionId` 后再次 `prompt` 成功，对话语义连续 |
| 18 | 取消 | `cancel` 后正在进行的 `prompt` 在合理时间内 resolve；会话仍可发起新一轮 `prompt` |

### 10.2 实现结构（指导，非完整代码）

1. **启动 Agent**：`spawn(command, argv, { stdio: ['pipe','pipe','pipe'], cwd })`，参数与集成说明完全一致。
2. **桥接流**：将子进程 stdin/stdout 转换为协议流，调用 `ndJsonStream(output, input)`（其它语言须等价实现）。
3. **构造 Client**：实现 `requestPermission`（自动选第一项）、`sessionUpdate`（记录所有 `update.sessionUpdate` 类型），按需实现 `extMethod` / `extNotification`。
4. **构造连接**：`new ClientSideConnection((agent) => clientHandlers, stream)`。
5. **按第 3 节顺序** 逐步调用，并按集成说明设定每一步的超时上限。
6. **断言**：覆盖 10.1 节全部验证项；记录 `sessionUpdate` 序列、首字节延迟、错误样本，作为验证报告附件。

### 10.3 验证报告交付

随提交版本附以下材料：

- 10.1 表的逐项结论（通过 / 不通过 + 关键证据）；
- 多轮、冷启动、首字节延迟、长输入、取消、并发约束的 **原始日志或 NDJSON 片段**；
- 第 8.5 节运行环境与依赖说明。

宿主据此判定本次接入是否准入；缺项一律不通过。

---

## 11. 提供方交付 Checklist

| # | 项 | 通过标准 |
|---|----|----------|
| 1 | stdio NDJSON | Agent 在子进程 stdin/stdout 上完整实现 ACP，stdout 仅承载协议帧 |
| 2 | 握手 | `initialize` 在阈值内返回；`PROTOCOL_VERSION` 与约定 SDK 一致 |
| 3 | 会话 | `newSession` / `loadSession`（按声明）按约定参数返回有效 `sessionId` |
| 4 | 流式 | 推送 `agent_message_chunk` 等可见输出类型 |
| 5 | 权限 | 兼容客户端自动选 `options[0]`；如需人工审批已书面单独约定 |
| 6 | 多轮 / 冷启动 | 第 8.1 与 10.1#7、#8 通过 |
| 7 | 首字节延迟 | 第 10.1#9 通过 |
| 8 | 输入边界 / 字符集 / 长输入 | 第 10.1#10 通过 |
| 9 | 并发约束 | 第 10.1#11 通过 |
| 10 | 取消与中断 | 第 8.2 / 10.1#18 通过 |
| 11 | 失败可观测 | 第 8.3 / 10.1#12 通过 |
| 12 | 安全 | 第 8.3 / 10.1#13：日志脱敏，机密不外泄 |
| 13 | 能力一致 | 第 8.4 / 10.1#14 通过 |
| 14 | 环境与依赖 | 第 8.5 / 10.1#15 全部交付 |
| 15 | 选模 | 第 7 / 10.1#16 通过 |
| 16 | 续聊 | 第 10.1#17 通过 |
| 17 | system prompt | 若 Agent 强依赖，已自行处理或书面与宿主约定 |
| 18 | 验证报告 | 第 10.3 节材料齐备，与线上启动方式一致 |

---

## 12. 文档维护

- SDK 或 Agent CLI 升级后，第 10.1 节全部条目须复测，并同步更新 `PROTOCOL_VERSION` 与集成说明。
- 宿主调整 MCP、权限、`initialize` 能力或超时阈值时，以宿主新版集成说明为准更新对接验证范围。
