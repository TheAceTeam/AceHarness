# napi-cj 文档索引

这个目录收纳 `@cangjielang/napi-cj` 通用桥接库，以及 ACEHarness Cangjie engine 业务库的接入设计。

## 总览

- [overview.md](overview.md)：完整概述，说明 `napi-cj`、Node-API addon、Cangjie 业务库和 ACEHarness engine adapter 的边界。
- [roadmap/migration-roadmap.md](roadmap/migration-roadmap.md)：分阶段实施计划和验收顺序。

## 底座详细设计

- [foundation/runtime-bridge-design.md](foundation/runtime-bridge-design.md)：通用 Node-API addon、`Cangjie.h` runtime 启动、C ABI、内存与泄漏检查。
- [foundation/abi-data-plane-design.md](foundation/abi-data-plane-design.md)：控制面 JSON、native buffer、event frame 与少拷贝数据面设计。
- [foundation/host-bridge-design.md](foundation/host-bridge-design.md)：Cangjie 通过 native callback 调用 TS/JS host 能力的设计。
- [foundation/build-packaging-design.md](foundation/build-packaging-design.md)：本地依赖、多平台 addon、Cangjie 业务库产物、中心仓依赖、构建信息和包契约。

## 模块迁移设计

- [modules/engine-design.md](modules/engine-design.md)：ACEHarness engine wrapper 层和 `aceharness-cj-engine` 业务库设计。

## 定位

- `@cangjielang/napi-cj` 是仓内本地依赖，不单独发布。
- `@cangjielang/napi-cj` 是通用桥接库，不包含 ACEHarness 业务代码。
- Cangjie `1.1.0+` 是最小支持基线。
- `aceharness-cj-engine` 构建期支持中心仓，运行期 JS 用户不需要中心仓凭据。
