# Engine 模块迁移设计

## 1. 目标

Engine 模块目标是把现有 wrapper 的核心执行路径迁移到 Cangjie，同时保留 JS wrapper 作为可配置 fallback。

当前代码范围按 engine 层定义为：**9 个逻辑引擎，13 个 concrete wrapper**。

## 2. 适配矩阵

| 逻辑引擎 | concrete wrapper | 当前实现类型 | driver 关系 | Cangjie provider |
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

当前涉及：

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
- `auto` 在本地 native 目标目录可用且 provider 支持时走 native，否则走 JS。
- 已经产生 stream/tool side effect 后不自动重跑 JS。

## 5. Cangjie 结构

```text
native/cangjie-engine/src/modules/engine/
  protocol/
    request.cj
    response.cj
    event.cj
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

Provider 接口：

```cangjie
public interface EngineProvider {
    func name(): String
    func supports(engine: String, driver: String): Bool
    func execute(
        request: EngineRunRequest,
        emit: (Int32, String, String) -> Unit
    ): EngineRunResult
    func cancel(requestId: String): Bool
}
```

## 6. compactContext

当前 `Engine` 接口有可选 `compactContext`。

当前策略：

- 不进入 native ABI。
- JS 侧保留现有可选行为。
- Cangjie wrapper 若未支持，返回 `null` 或不实现该方法。
- 需要迁移时，作为 engine 模块子能力补一个 `operation=compactContext`。

## 7. 测试

建议覆盖：

- `tests/engine-factory-pooling.test.ts`
- `tests/engine-driver-resolution.test.ts`
- `tests/acp-wrapper-base.test.ts`
- `tests/wrapper-availability.test.ts`
- `tests/opencode-sdk-wrapper.test.ts`
- `tests/result-channel.test.ts`

验收：

- `engineRuntime=js` 不加载 addon。
- `engineRuntime=cangjie` 走 native。
- `engineRuntime=auto` native 可用时优先 native。
- stream event 能还原为 `EngineStreamEvent`。
- cancel 生效。
- sessionId 正常回传。
