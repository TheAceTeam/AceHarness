# napi-cj 文档索引

这个目录收纳 ACEHarness 中 `@cangjielang/napi-cj` 相关的总体设计、底座设计和 engine 模块设计。

## 总览

- [overview.md](overview.md)：完整概述，说明 `napi-cj` 的定位、分层、模块边界和目标。
- [roadmap/migration-roadmap.md](roadmap/migration-roadmap.md)：分阶段实施计划和验收顺序。

## 底座详细设计

- [foundation/runtime-bridge-design.md](foundation/runtime-bridge-design.md)：Node-API addon、`Cangjie.h` runtime 启动、C ABI、内存与泄漏检查。
- [foundation/host-bridge-design.md](foundation/host-bridge-design.md)：Cangjie 通过 native callback 调用 TS/JS host 能力的设计。
- [foundation/build-packaging-design.md](foundation/build-packaging-design.md)：本地依赖、多平台产物、中心仓依赖、构建信息和包契约。

## 模块迁移设计

- [modules/engine-design.md](modules/engine-design.md)：engine wrapper 层迁移设计。

## 当前定位

- `@cangjielang/napi-cj` 是仓内本地依赖，不单独发布。
- Cangjie `1.1.0+` 是最小支持基线。
- 构建期支持中心仓，运行期 JS 用户不需要中心仓凭据。
