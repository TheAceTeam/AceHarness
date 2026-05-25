# wasm-cj 方案概述

## 1. 定位

`wasm-cj` 是 Cangjie 到 WebAssembly 的长期后端方案。它的目标是让 Cangjie 业务代码可以编译成 `.wasm`，并在 Node、浏览器、Electron、Worker 或其他 WebAssembly runtime 中执行。

`wasm-cj` 与 `napi-cj` 是并行方案：

| 方案 | 运行形态 | 适用场景 |
| --- | --- | --- |
| `napi-cj` | Node-API addon + Cangjie native dynamic library | Node 桌面端、本机性能、本机进程能力、完整 Cangjie runtime |
| `wasm-cj` | WebAssembly module + JS host bindings | 浏览器、沙箱执行、跨平台分发、轻量部署、权限隔离 |

`wasm-cj` 不替代 `napi-cj`。它提供另一条部署路径：把 Cangjie 业务能力打包成 wasm module，由 JS host 显式提供 I/O、文件、网络、时间、日志、配置等能力。

## 2. Cangjie_compiler 分析

- `cangjie_compiler/third_party/CMakeLists.txt` 中 LLVM target 配置为 `ARM|AArch64|X86`。
- `cangjie_compiler/src/Driver/Backend/CJNATIVEBackend.cpp` 的 toolchain 分发覆盖 Linux、OHOS、Android、Windows GNU、Darwin、iOS。
- `cangjie_compiler/src/Driver/Toolchains/BackendOptions.inc` 的链接选项绑定 native libc、pthread、dl、平台系统库。
- 检索 `cangjie_compiler`、`cangjie_runtime`、`llvm-project` 未发现可直接使用的 wasm / wasi backend 接入。

这些信息说明：Cangjie compiler 已经通过 LLVM `opt` / `llc` 路线生成 native 目标，但 wasm 目标、wasm toolchain、runtime subset、标准库适配和 host ABI 都需要系统设计。

## 3. 可行性结论

`wasm-cj` 技术上可行，工程量为编译器/runtime 级别。

可行性来源：

- LLVM 具备 WebAssembly target 能力。
- Cangjie native backend 已经有 LLVM bitcode 到目标码的后端管线。
- Cangjie 的 C ABI / FFI 思路可以映射成 wasm import/export ABI。
- JS host 适合承接文件、网络、日志、配置、时间、随机数等 capability。

主要难点：

- Cangjie runtime 需要 wasm 版本或 wasm subset。
- GC、异常、线程、TLS、栈扫描、反射、动态加载等 runtime 能力需要重新定义。
- 标准库中依赖 OS 的模块需要 host binding 或裁剪。
- WebAssembly 线性内存与 Cangjie 对象模型之间需要稳定边界。
- 浏览器和 Node 的 host 能力差异需要 capability model。

## 4. 文档结构

- [feasibility.md](feasibility.md)：可行性、技术路线和关键风险。
- [workload.md](workload.md)：工作量拆分、阶段产物和工程规模估算。
- [interoperability.md](interoperability.md)：wasm 与 JS、Cangjie、ACEHarness 的互操作模型。
