# napi-cj engine 实施路线

## Phase 0：文档与骨架

- 建立 `docs/napi-cj` 文档集。
- 建 `packages/napi-cj` 本地包。
- 建 `native/napi-cj-addon`。
- 建 `native/cangjie-engine`。
- vendored `vendor/cangjie-sdk/include/Cangjie.h`。

验收：

- 根包能解析 `@cangjielang/napi-cj`。
- 空 addon 可以被 require。
- build 链路不破坏现有测试。

## Phase 1：Runtime Bridge

- `CangjieRuntimeManager`
- runtime init / library load
- symbol resolve
- string free
- leak checkpoint
- build-info

验收：

- native smoke 成功。
- runtime 只初始化一次。
- 缺 native 产物时错误可诊断。

## Phase 2：Host Bridge

- `onEvent`
- `onHostCall`
- timeout / cancel
- host capability registry
- `diagnostic.log`
- `config.get`
- `engine.metadata`

验收：

- Cangjie 能调用 TS handler。
- handler reject / timeout 转成稳定错误。
- 不允许未注册 capability。

## Phase 3：Engine 模块

- engine runtime config
- `CangjieRuntimeEngineWrapper`
- 13 个 provider
- stream / cancel / session
- JS fallback

验收：

- 9 个逻辑引擎、13 个 concrete wrapper 全覆盖。
- `engineRuntime=js|cangjie|auto` 行为正确。
- 现有 engine 测试不回退。
