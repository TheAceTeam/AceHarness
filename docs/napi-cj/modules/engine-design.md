# Engine 模块迁移设计

## 1. 目标

Engine 模块目标是把 wrapper 的核心执行路径迁移到独立 Cangjie 业务库 `aceharness-cj-engine`，并提供 JS wrapper 配置兜底。

`@cangjielang/napi-cj` 只负责通用 runtime bridge；engine provider、engine 协议、`seajson`、`markit` 和 wrapper 适配逻辑都属于 `aceharness-cj-engine` 与 ACEHarness TS adapter。

engine 层范围定义为：**9 个逻辑引擎，13 个 concrete wrapper**。

## 2. 适配矩阵

| 逻辑引擎 | concrete wrapper | 实现类型 | driver 关系 | Cangjie provider |
| --- | --- | --- | --- | --- |
| `claude-code` | `claude-code` | SDK wrapper | `sdk` | `claude_code_provider.cj` |
| `claude-code` | `claude-code-acp` | ACP stdio wrapper | `stdio` | `claude_code_acp_provider.cj` |
| `opencode` | `opencode` | ACP stdio wrapper | `stdio` | `opencode_provider.cj` |
| `opencode` | `opencode-sdk` | SDK / HTTP wrapper | `sdk` | `opencode_sdk_provider.cj` |
| `nga` | `nga` | ACP stdio wrapper | `stdio` | `nga_provider.cj` |
| `nga` | `nga-sdk` | SDK / HTTP wrapper | `sdk` | `nga_sdk_provider.cj` |
| `codegenie` | `codegenie` | ACP stdio wrapper | `stdio` | `codegenie_provider.cj` |
| `codegenie` | `codegenie-sdk` | SDK / HTTP wrapper | `sdk` | `codegenie_sdk_provider.cj` |
| `kiro-cli` | `kiro-cli` | ACP stdio wrapper | single | `kiro_cli_provider.cj` |
| `cursor` | `cursor` | ACP stdio wrapper | single | `cursor_provider.cj` |
| `trae-cli` | `trae-cli` | ACP stdio wrapper | single | `trae_cli_provider.cj` |
| `magic-cli` | `magic-cli` | ACP stdio wrapper | single | `magic_cli_provider.cj` |
| `codex` | `codex` | SDK / client wrapper | single | `codex_provider.cj` |

Driver-capable 逻辑引擎：

- `claude-code`
- `opencode`
- `nga`
- `codegenie`

## 3. TS 接入点

- `src/lib/engines/engine-interface.ts`
- `src/lib/engines/engine-selection.ts`
- `src/lib/engines/engine-factory.ts`
- `src/lib/engines/cangjie-runtime-wrapper.ts`
- `src/lib/engines/index.ts`
- `src/lib/core/engine-metadata.ts`
- `src/app/api/engine/route.ts`
- `src/app/engines/page.tsx`
- `src/app/setup/page.tsx`
- `src/components/EngineSelect.tsx`
- `src/components/EngineModelSelect.tsx`
- `src/cli.ts`

## 4. Runtime 配置

```ts
export type EngineRuntime = 'js' | 'cangjie' | 'auto';
```

Engine config JSON：

```json
{
  "engine": "opencode",
  "driver": "sdk",
  "engineRuntime": "auto",
  "cangjieRuntime": {
    "enabled": true,
    "fallbackToJs": true,
    "library": {
      "name": "aceharness-cj-engine",
      "path": "native/aceharness-cj-engine/artifacts/<target>/aceharness_cj_engine"
    },
    "engines": {
      "opencode": "auto",
      "nga": "auto",
      "codegenie": "auto",
      "codex": "auto",
      "claude-code": "auto",
      "cursor": "auto",
      "kiro-cli": "auto",
      "magic-cli": "auto",
      "trae-cli": "auto"
    }
  }
}
```

规则：

- `js` 强制 JS wrapper。
- `cangjie` 强制 native；失败时按 `fallbackToJs` 决定。
- `auto` 在 `napi_cj.node`、业务库和 provider 都可用时走 native，否则走 JS。
- 已经产生 stream/tool side effect 后不自动重跑 JS。

## 5. Engine Data Plane

engine 请求通过 `@cangjielang/napi-cj` 的通用 `callData` 传入 `aceharness-cj-engine`：

| 数据 | 传输方式 | 所属层 |
| --- | --- | --- |
| `domain=engine` / `operation=execute` | C string | napi-cj 通用 ABI |
| `requestId` | C string | napi-cj 通用 ABI |
| `engine` / `driver` / `model` / `workingDirectory` / flags | `options_json` | ACEHarness engine 协议 |
| `prompt` / `systemPrompt` / `contextMarkdown` | named `napi_cj_slice` | ACEHarness engine 协议 |
| stream text / tool payload / thought | `napi_cj_event_frame_v1` | ACEHarness engine 协议 |
| usage / cost / stopReason / sessionId | `result_json` | ACEHarness engine 协议 |
| final output | streamed frames 或 result buffer | ACEHarness engine 协议 |

TS wrapper 到 `napi-cj`：

```ts
const result = await library.callData({
  requestId: options.runId || crypto.randomUUID(),
  domain: 'engine',
  operation: 'execute',
  optionsJson: JSON.stringify({
    engine: this.targetEngine,
    driver: this.targetDriver,
    model: options.model,
    workingDirectory: options.workingDirectory,
    timeoutMs: options.timeoutMs,
    sessionId: options.sessionId,
    forceNewSession: options.forceNewSession,
    diagnosticLogging: options.diagnosticLogging,
  }),
  inputs: {
    prompt: options.prompt,
    systemPrompt: options.systemPrompt,
  },
  onFrame: (frame) => {
    this.emit('stream', convertEngineFrame(frame));
  },
  onHostCall: hostCapabilityRegistry.call,
});
```

Cangjie provider 接口维持业务语义，request 内的大文本是 input view：

```cangjie
public interface EngineProvider {
    func name(): String
    func supports(engine: String, driver: String): Bool
    func execute(
        request: EngineRunRequest,
        emit: (EngineFrame) -> Bool
    ): EngineRunResult
    func cancel(requestId: String): Bool
}
```

Cangjie 侧只有在需要 `markit` 解析或 session 持久化时，才把 slice 转成 Cangjie `String`。

## 6. Cangjie 业务库结构

```text
native/aceharness-cj-engine/src/modules/engine/
  protocol/
    request.cj
    response.cj
    event.cj
    host_call.cj
  registry.cj
  session_store.cj
  cancel_registry.cj
  providers/
    provider.cj
    claude_code_provider.cj
    claude_code_acp_provider.cj
    codex_provider.cj
    cursor_provider.cj
    kiro_cli_provider.cj
    magic_cli_provider.cj
    opencode_provider.cj
    opencode_sdk_provider.cj
    nga_provider.cj
    nga_sdk_provider.cj
    codegenie_provider.cj
    codegenie_sdk_provider.cj
    trae_cli_provider.cj
```

Provider input view：

```cangjie
public struct EngineInputView {
    public let promptPtr: CPointer<UInt8>
    public let promptLen: Int64
    public let systemPromptPtr: CPointer<UInt8>
    public let systemPromptLen: Int64
    public let contextMarkdownPtr: CPointer<UInt8>
    public let contextMarkdownLen: Int64
}
```

## 7. Cangjie 业务库构建

`native/aceharness-cj-engine/cjpm.toml`：

```toml
[package]
  cjc-version = "1.1.0"
  name = "aceharness_cj_engine"
  version = "0.1.0"
  output-type = "dynamic"
  compile-option = "--static-std -Woff unused"

[dependencies]
  seajson = { version = "1.4.7", output-type = "static" }
  markit = { version = "0.0.3", output-type = "static" }
```

产物结构：

```text
native/aceharness-cj-engine/artifacts/
  win32-x64-msvc/
    aceharness_cj_engine.dll
    build-info.json
  darwin-arm64/
    libaceharness_cj_engine.dylib
    build-info.json
  linux-x64-gnu/
    libaceharness_cj_engine.so
    build-info.json
```

约束：

- 支持 Cangjie `1.1.0+`。
- 支持中心仓依赖解析。
- 中心仓只参与 Cangjie 业务库构建链路。
- JS 用户不需要中心仓 token、不需要本地 `cjpm`。
- `seajson` 用于 engine 控制面 JSON 编解码。
- `markit` 用于 Markdown 解析、生成和文本标准化。
- `seajson`、`markit` 静态链接进 `aceharness_cj_engine`。

`build-info.json`：

```json
{
  "library": "aceharness_cj_engine",
  "abiVersion": 1,
  "sdkVersion": "1.1.0",
  "dependencies": {
    "seajson": "1.4.7",
    "markit": "0.0.3"
  },
  "target": "win32-x64-msvc",
  "gitCommit": "...",
  "builtAt": "..."
}
```

## 8. compactContext

`Engine` 接口有可选 `compactContext`。

策略：

- 不进入 native ABI。
- JS 侧维持可选行为。
- Cangjie wrapper 返回 `null` 或不实现该方法。
- native ABI 只覆盖 execute、cancel、session 和 stream。

## 9. 测试

测试覆盖：

- `tests/engine-factory-pooling.test.ts`
- `tests/engine-driver-resolution.test.ts`
- `tests/acp-wrapper-base.test.ts`
- `tests/wrapper-availability.test.ts`
- `tests/opencode-sdk-wrapper.test.ts`
- `tests/result-channel.test.ts`

验收：

- `engineRuntime=js` 不加载 addon。
- `engineRuntime=cangjie` 走 native。
- `engineRuntime=auto` native 可用时选择 native。
- `@cangjielang/napi-cj` 不导出 engine provider 或 engine 常量。
- 1MB prompt 不进入 JSON request body。
- 1000 个 stream frame 不触发 per-frame JSON parse。
- stream event 能还原为 `EngineStreamEvent`。
- cancel 生效。
- sessionId 正常回传。
