# Runtime Bridge 详细设计

## 1. 目标

Runtime bridge 是 `@cangjielang/napi-cj` 的 native 底座，负责：

- 通过 `Cangjie.h` 初始化 Cangjie runtime。
- 加载外部 Cangjie 业务动态库。
- 解析 `napi_cj_*` C ABI 导出符号。
- 管理线程、字符串、native buffer、callback、泄漏检查。
- 为 JS/TS 提供通用 Cangjie native call 能力。

Runtime bridge 不包含 ACEHarness engine provider，不依赖 `seajson`、`markit`，不识别具体 engine 名称。

## 2. Cangjie.h

头文件放置：

```text
vendor/cangjie-sdk/include/Cangjie.h
```

约束：

- 项目内 vendored，不依赖用户机器头文件。
- SDK 升级时同步更新 `Cangjie.h`、native smoke、平台产物。
- 最小支持 Cangjie `1.1.0+`。

启动顺序：

1. `InitCJRuntime(...)`
2. `LoadCJLibraryWithInit(...)`
3. `LoadLibrary` / `dlopen`
4. `GetProcAddress` / `dlsym`
5. 调用业务库导出的 `napi_cj_*` 函数

## 3. RuntimeManager

```cpp
class CangjieRuntimeManager {
public:
  static CangjieRuntimeManager& Instance();

  bool EnsureRuntimeInitialized(std::string* error);
  bool LoadLibrary(const NativeLibrarySpec& spec, std::string* error);
  void* ResolveSymbol(const NativeLibraryHandle& handle, const char* name, std::string* error);
  RuntimeLeakSnapshot Snapshot() const;

private:
  CangjieRuntimeManager() = default;
  std::once_flag init_flag_;
  bool runtime_ok_ = false;
  RuntimeParam runtime_param_{};
  std::mutex libraries_mutex_;
  std::unordered_map<std::string, NativeLibraryHandle> libraries_;
};
```

生命周期策略：

- Node 进程内只初始化一次 Cangjie runtime。
- 每个业务动态库按绝对路径加载一次。
- 业务库 handle 由 `napi_cj_library_create_v1` / `napi_cj_library_destroy_v1` 管理。
- 生产环境不主动 unload Cangjie runtime。
- runtime degraded 后停止复用已有 native handle，但不自动重放已产生副作用的调用。

## 4. ABI 分层

runtime bridge 同时支持控制面和数据面。

控制面使用 JSON，适合 smoke、diagnostics、build info 和小体量 capability 调用：

```c
typedef char* (*napi_cj_host_call_callback)(
  const char* request_json,
  void* user_data
);

typedef void (*napi_cj_host_free_string_callback)(
  const char* ptr,
  void* user_data
);

char* napi_cj_call_control_json_v1(
  void* library_ctx,
  const char* domain,
  const char* operation,
  const char* payload_json,
  napi_cj_host_call_callback host_call,
  napi_cj_host_free_string_callback host_free_string,
  void* user_data
);
```

数据面使用 named slice 和 event frame：

```c
typedef struct napi_cj_slice {
  const uint8_t* data;
  size_t len;
} napi_cj_slice;

typedef struct napi_cj_named_slice {
  const char* name;
  napi_cj_slice bytes;
} napi_cj_named_slice;

typedef struct napi_cj_call_request_v1 {
  uint32_t abi_version;
  uint32_t struct_size;
  const char* request_id;
  const char* domain;
  const char* operation;
  const char* options_json;
  const napi_cj_named_slice* inputs;
  size_t input_count;
  void* user_data;
} napi_cj_call_request_v1;

typedef struct napi_cj_event_frame_v1 {
  uint32_t abi_version;
  uint32_t struct_size;
  uint64_t seq;
  uint16_t kind;
  uint16_t flags;
  napi_cj_slice payload;
  const char* metadata_json;
} napi_cj_event_frame_v1;

typedef int32_t (*napi_cj_emit_frame_callback)(
  const napi_cj_event_frame_v1* frame,
  void* user_data
);
```

数据面入口：

```c
int32_t napi_cj_call_data_v1(
  void* library_ctx,
  const napi_cj_call_request_v1* request,
  napi_cj_emit_frame_callback emit_frame,
  napi_cj_host_call_callback host_call,
  napi_cj_host_free_string_callback host_free_string,
  napi_cj_call_result_v1* result
);
```

完整 data plane 设计见 [abi-data-plane-design.md](abi-data-plane-design.md)。

## 5. 内存规则

- Cangjie 返回给 C++ 的字符串由业务库分配。
- C++ 用完后调用业务库导出的 `napi_cj_free_string_v1`。
- 大文本输入由 addon 持有为 JS `Buffer` / native arena，并以 `napi_cj_slice` 传给 Cangjie。
- Cangjie 业务库不保存输入 slice；需要跨调用保存时必须复制到业务库自己的 store。
- stream frame payload 在 callback 返回后不得继续引用，除非使用 addon-owned ring buffer reserve / commit 模式。
- Cangjie 返回的大 buffer 通过 `napi_cj_free_buffer_v1` 释放。
- host callback 返回给 Cangjie 的字符串由 addon 分配。
- Cangjie 拷贝后调用 `hostFreeString`。
- `options_json` 生命周期由 C++ 保证到 native 调用返回。

## 6. 泄漏检查

Debug / diagnostics 模式启用：

```cpp
struct RuntimeLeakSnapshot {
  uint64_t outstanding_library_handles = 0;
  uint64_t outstanding_cj_strings = 0;
  uint64_t outstanding_cj_buffers = 0;
  uint64_t outstanding_native_buffers = 0;
  uint64_t outstanding_event_frames = 0;
  uint64_t outstanding_host_strings = 0;
  uint64_t outstanding_request_contexts = 0;
  uint64_t outstanding_tsfn_streams = 0;
  uint64_t call_started = 0;
  uint64_t call_finished = 0;
  uint64_t cancel_requested = 0;
};
```

检查点：

- library create / destroy
- Cangjie returned string allocate / free
- Cangjie returned buffer allocate / free
- native input buffer pin / unpin
- event frame enqueue / consume
- host returned string allocate / free
- request context create / finish / cancel
- TSFN create / release

边界：

- 只检查 addon 与 C ABI 边界上可追踪资源。
- 检查范围不覆盖完整 Cangjie runtime 堆。
- runtime 官方内存统计接口作为 optional source 接入 snapshot。

## 7. 线程模型

统一走 native worker 线程：

- JS 主线程只发起调用。
- worker 线程进入 Cangjie runtime。
- stream 事件通过 `ThreadSafeFunction` 回 JS。
- host callback 也通过 `ThreadSafeFunction` 调 JS handler。

禁止 JS 主线程同步等待 native 后，native 再同步等待 JS 主线程造成死锁。

## 8. 测试

- runtime init 成功。
- business library load 成功。
- `napi_cj_*` symbol resolve 成功。
- callControl smoke 成功。
- callData smoke 成功。
- returned string free 配平。
- returned buffer free 配平。
- host returned string free 配平。
- runtime degraded 状态可观测。
