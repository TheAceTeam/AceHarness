# napi-cj Host Bridge 设计

## 1. 目标

Host bridge 解决的问题是：Cangjie engine 执行过程中，需要调用 ACEHarness 现有 TS/JS 能力。

这里不是让 Cangjie 直接 import TS 模块，而是通过 `napi-cj` 提供一条受控调用链：

```text
Cangjie provider
  -> C ABI callback
  -> Node-API addon HostBridge
  -> registered TS host handler
```

适合放进 host bridge 的能力：

- 读取 ACEHarness 运行时配置
- 查询模型、engine 元数据、workspace 信息
- 请求 JS 侧执行已有服务能力
- 触发 tool call / host capability
- 记录诊断日志或调试事件

不适合放进 host bridge 的能力：

- 高频 token 流输出，流事件继续走 `emit`
- 大文件传输
- 长时间阻塞的外部进程
- 绕过权限模型的文件、网络、shell 操作

## 2. 分层边界

```mermaid
sequenceDiagram
  participant CJ as Cangjie Provider
  participant ABI as C ABI callback
  participant ADDON as napi-cj Addon
  participant TSFN as ThreadSafeFunction
  participant TS as TS Host Handler

  CJ->>ABI: hostCall(requestJson)
  ABI->>ADDON: HostBridge::Call(requestJson)
  ADDON->>TSFN: dispatch to JS thread
  TSFN->>TS: onHostCall(request)
  TS-->>TSFN: responseJson
  TSFN-->>ADDON: resolve / reject
  ADDON-->>ABI: CString response
  ABI-->>CJ: responseJson
```

关键原则：

- Cangjie 只知道 JSON request / JSON response。
- addon 负责线程切换、等待、超时、错误包装。
- TS 侧只实现注册好的 host handler。
- 所有 host capability 必须走白名单。

## 3. C ABI 草案

`emit` 和 `hostCall` 分开设计。

- `emit`：事件流，单向、轻量、尽量不阻塞。
- `hostCall`：请求 TS 能力，有返回值、带超时、可失败。

```cangjie
@C
public func ace_cj_engine_execute_json_with_host_callback(
    handle: CPointer<Unit>,
    requestJson: CString,
    emit: CFunc<(Int32, CString, CString, CPointer<Unit>) -> Unit>,
    hostCall: CFunc<(CString, CPointer<Unit>) -> CString>,
    hostFreeString: CFunc<(CString, CPointer<Unit>) -> Unit>,
    userData: CPointer<Unit>
): CString
```

内存规则：

- `requestJson` 由 addon 持有，生命周期覆盖 native 调用。
- `hostCall` 返回的 `CString` 由 addon 分配。
- Cangjie 侧必须在拷贝为 Cangjie `String` 后调用 `hostFreeString`。
- Cangjie 返回给 addon 的字符串仍然走 `ace_cj_engine_free_string`。

## 4. Host Request 协议

请求统一是 JSON：

```json
{
  "id": "host-call-001",
  "capability": "config.get",
  "timeoutMs": 3000,
  "payload": {
    "key": "engineRuntime"
  }
}
```

响应统一是 JSON：

```json
{
  "id": "host-call-001",
  "ok": true,
  "result": {
    "value": "auto"
  }
}
```

错误响应：

```json
{
  "id": "host-call-001",
  "ok": false,
  "error": {
    "code": "HOST_CAPABILITY_NOT_ALLOWED",
    "message": "Capability is not registered"
  }
}
```

默认 capability 建议：

| capability | 用途 |
| --- | --- |
| `config.get` | 读取只读配置 |
| `engine.metadata` | 查询 engine 元数据 |
| `model.resolve` | 查询模型配置 |
| `workspace.info` | 获取工作目录、session 信息 |
| `diagnostic.log` | 写诊断日志 |

## 5. TS API 草案

`@cangjielang/napi-cj` 暴露的 TS 类型：

```ts
export interface HostCallRequest {
  id: string;
  capability: string;
  timeoutMs?: number;
  payload?: unknown;
}

export interface HostCallResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type HostCallHandler = (
  request: HostCallRequest
) => Promise<HostCallResponse> | HostCallResponse;

export interface NativeExecuteOptions {
  engine: string;
  driver: string;
  requestJson: string;
  onEvent?: (eventType: number, contentJson: string, metadataJson: string) => void;
  onHostCall?: HostCallHandler;
}
```

ACEHarness wrapper 中的使用方式：

```ts
const resultJson = await addon.execute({
  engine: this.targetEngine,
  driver: this.targetDriver,
  requestJson,
  onEvent: (eventType, contentJson, metadataJson) => {
    this.emit('stream', convertNativeEvent(eventType, contentJson, metadataJson));
  },
  onHostCall: async (request) => {
    return hostCapabilityRegistry.call(request);
  },
});
```

## 6. Addon 内部模型

建议在 `native/napi-cj-addon/src/` 下增加：

```text
host_bridge.h
host_bridge.cc
host_call_context.h
host_call_context.cc
```

核心职责：

- 保存 JS `onHostCall` 的 `ThreadSafeFunction`
- 把 C ABI 的 `CString` request 转为 JS 字符串
- 在 JS 线程调用 handler
- 等待 handler 返回或 rejected
- 把结果包装成 JSON response
- 分配返回 `CString`
- 提供 `hostFreeString`

阻塞点只允许发生在 native worker 线程，不允许阻塞 JS 主线程。

## 7. 超时与取消

每个 host call 必须有超时。

优先级：

1. request 内 `timeoutMs`
2. execute options 的默认 host timeout
3. addon 默认值，建议 `3000ms`

取消规则：

- 如果 JS 调用 `cancel(requestId)`，addon 标记当前 execute canceled。
- 之后新的 host call 直接返回 `HOST_CALL_CANCELLED`。
- 已经派发到 JS 的 host call 等待当前 handler 返回或超时，不强行杀 JS 逻辑。
- Cangjie provider 收到取消错误后应尽快停止执行。

## 8. 死锁控制

必须避免这些模式：

- JS 主线程同步等待 native，native 又同步等待 JS 主线程。
- host handler 内再次调用同一个 addon execute。
- host handler 长时间等待当前 execute 的最终结果。

约束：

- `execute()` 在 native worker 线程运行。
- `hostCall` 只能阻塞 native worker 线程。
- JS handler 必须是异步安全的普通函数。
- addon 对嵌套 execute 做检测，发现同一 request 链路重入时返回 `HOST_REENTRANT_CALL`。

## 9. 安全与权限

Host bridge 是 Cangjie 调用 JS 能力的入口，必须默认收紧。

要求：

- capability 白名单注册。
- 默认不允许文件写入、shell、网络请求。
- 文件读取必须限定 workspace / ACEHarness data 目录。
- 所有错误响应不得泄漏 token、环境变量、完整密钥。
- diagnostic log 默认脱敏。

不开放任意 JS eval、任意 module import、任意 shell。

## 10. Cangjie 侧使用示意

```cangjie
public func callHostConfigGet(
    hostCall: CFunc<(CString, CPointer<Unit>) -> CString>,
    hostFreeString: CFunc<(CString, CPointer<Unit>) -> Unit>,
    userData: CPointer<Unit>,
    key: String
): String {
    let request = encodeHostRequest("config.get", key)
    let responsePtr = hostCall(request.toCString(), userData)
    let response = copyCStringToString(responsePtr)
    hostFreeString(responsePtr, userData)
    return response
}
```

规则：

- Cangjie provider 不直接拼接复杂 JSON。
- host request / response 编解码集中到 `protocol/host_call.cj`。
- host call 错误转换成 engine error 或 diagnostic event。

## 11. 测试计划

Native / addon：

- host callback 未注册时返回明确错误。
- sync handler 正常返回。
- async handler 正常返回。
- handler reject 转成 JSON 错误。
- timeout 生效。
- cancel 后新 host call 直接失败。
- `hostFreeString` 计数配平，无 outstanding string。

JS 集成：

- `CangjieRuntimeEngineWrapper` 能注册 `onHostCall`。
- `config.get` 能读取 engine runtime 配置。
- `diagnostic.log` 不影响 execute 结果。
- host handler 不能触发同 request 的递归 execute。

## 12. 当前边界

host bridge 的最小闭环：

- `diagnostic.log`
- `config.get`
- `engine.metadata`

不在当前边界做：

- 任意 tool execution
- 大文件传输
- shell / network host capability
- Cangjie 侧直接调用 TS 模块
