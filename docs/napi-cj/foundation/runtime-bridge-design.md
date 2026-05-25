# Runtime Bridge 详细设计

## 1. 目标

Runtime bridge 是 `napi-cj` 的 native 底座，负责：

- 通过 `Cangjie.h` 初始化 Cangjie runtime。
- 加载 Cangjie 动态库。
- 解析 C ABI 导出符号。
- 管理线程、字符串、callback、泄漏检查。
- 为 engine wrapper 提供 native 调用入口。

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
5. 调用 `ace_cj_*` 导出函数

## 3. RuntimeManager

```cpp
class CangjieRuntimeManager {
public:
  static CangjieRuntimeManager& Instance();

  bool EnsureInitialized(std::string* error);
  bool EnsureLibraryLoaded(std::string* error);
  void* ResolveSymbol(const char* name, std::string* error);
  std::string LibraryPath() const;
  RuntimeLeakSnapshot Snapshot() const;

private:
  CangjieRuntimeManager() = default;
  std::once_flag init_flag_;
  std::once_flag load_flag_;
  bool runtime_ok_ = false;
  bool library_ok_ = false;
  RuntimeParam runtime_param_{};
  void* library_handle_ = nullptr;
};
```

生命周期策略：

- Node 进程内只初始化一次 runtime。
- Cangjie 动态库只加载一次。
- 不做 unload / deinit。
- runtime degraded 后停止复用已有 native handle，但不自动重放已产生副作用的调用。

## 4. 通用 C ABI

建议 ABI 朝模块化调用演进：

```c
typedef void (*ace_cj_emit_callback)(
  int32_t event_type,
  const char* content_json,
  const char* metadata_json,
  void* user_data
);

typedef char* (*ace_cj_host_call_callback)(
  const char* request_json,
  void* user_data
);

typedef void (*ace_cj_host_free_string_callback)(
  const char* ptr,
  void* user_data
);

char* ace_cj_call_module_json_with_host_callback(
  void* handle,
  const char* module,
  const char* operation,
  const char* request_json,
  ace_cj_emit_callback emit,
  ace_cj_host_call_callback host_call,
  ace_cj_host_free_string_callback host_free_string,
  void* user_data
);
```

engine 执行入口可以使用专用导出：

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

addon 内部保留 `ModuleBridge` 抽象，用于统一处理 JSON 调用、事件和 host callback。

## 5. 内存规则

- Cangjie 返回给 C++ 的字符串由 Cangjie 分配。
- C++ 用完后调用 `ace_cj_free_string` 或模块专用 free。
- host callback 返回给 Cangjie 的字符串由 addon 分配。
- Cangjie 拷贝后调用 `hostFreeString`。
- `requestJson` 生命周期由 C++ 保证到 native 调用返回。

## 6. 泄漏检查

Debug / diagnostics 模式启用：

```cpp
struct RuntimeLeakSnapshot {
  uint64_t outstanding_handles = 0;
  uint64_t outstanding_cj_strings = 0;
  uint64_t outstanding_host_strings = 0;
  uint64_t outstanding_request_contexts = 0;
  uint64_t outstanding_tsfn_streams = 0;
  uint64_t call_started = 0;
  uint64_t call_finished = 0;
  uint64_t cancel_requested = 0;
};
```

检查点：

- handle create / destroy
- Cangjie returned string allocate / free
- host returned string allocate / free
- request context create / finish / cancel
- TSFN create / release

边界：

- 只检查 addon 与 C ABI 边界上可追踪资源。
- 不声称完整检查 Cangjie runtime 堆。
- 如果未来 runtime 暴露正式内存统计接口，再接入 snapshot。

## 7. 线程模型

统一走 native worker 线程：

- JS 主线程只发起调用。
- worker 线程进入 Cangjie runtime。
- stream 事件通过 `ThreadSafeFunction` 回 JS。
- host callback 也通过 `ThreadSafeFunction` 调 JS handler。

禁止 JS 主线程同步等待 native 后，native 再同步等待 JS 主线程造成死锁。

## 8. 测试

- runtime init 成功。
- library load 成功。
- symbol resolve 成功。
- callModule smoke 成功。
- returned string free 配平。
- host returned string free 配平。
- runtime degraded 状态可观测。
