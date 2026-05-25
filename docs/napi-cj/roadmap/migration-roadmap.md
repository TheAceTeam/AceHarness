# napi-cj engine 实施路线

## Phase 0：文档与骨架

- 建立 `docs/napi-cj` 文档集。
- 建 `packages/napi-cj` 通用本地包。
- 建 `native/napi-cj-addon` 通用 Node-API addon。
- 建 `native/aceharness-cj-engine` Cangjie 业务库。
- vendored `vendor/cangjie-sdk/include/Cangjie.h`。

验收：

- 根包能解析 `@cangjielang/napi-cj`。
- 空 addon 可以被 require。
- `@cangjielang/napi-cj` 不包含 engine provider 或 ACEHarness 业务常量。
- build 链路不破坏现有测试。

## Phase 1：Runtime Bridge

- `CangjieRuntimeManager`
- runtime init
- business library load
- `napi_cj_*` symbol resolve
- string / buffer free
- leak checkpoint
- addon build-info

验收：

- native smoke 成功。
- runtime 只初始化一次。
- 缺 addon 产物时错误可诊断。
- 缺 business library 产物时错误可诊断。

## Phase 2：Host Bridge

- `onFrame`
- `onHostCall`
- timeout / cancel
- host capability registry
- `diagnostic.log`
- `config.get`
- `metadata.get`

验收：

- Cangjie 业务库能调用 TS handler。
- handler reject / timeout 转成稳定错误。
- 不允许未注册 capability。

## Phase 3：Engine 业务库

- engine runtime config
- `CangjieRuntimeEngineWrapper`
- `aceharness-cj-engine` 13 个 provider
- stream / cancel / session
- JS fallback

验收：

- 9 个逻辑引擎、13 个 concrete wrapper 全覆盖。
- `engineRuntime=js|cangjie|auto` 行为正确。
- 现有 engine 测试不回退。
