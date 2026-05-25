# wasm-cj 工作量评估

## 1. 总体规模

`wasm-cj` 是编译器、runtime、标准库、JS host runtime 的联合工程。

规模判断：

| 范围 | 工程量 | 说明 |
| --- | --- | --- |
| PoC | 4-8 周 | 单平台开发环境，纯函数编译到 wasm，Node 加载执行 |
| MVP | 3-6 个月 | runtime subset、host ABI、基础标准库、CI、npm loader |
| 可产品化 | 6-12 个月 | 稳定 ABI、调试、错误模型、性能、浏览器/Node 双 host |
| 完整后端 | 12 个月以上 | runtime 完整性、并发、标准库覆盖、工具链生态 |

## 2. 工作包

### Compiler Backend

任务：

- LLVM 构建加入 `WebAssembly` target。
- driver target triple 支持 wasm。
- 新增 wasm backend / toolchain。
- 产物支持 `.wasm`、`.wat`、`.wasm.map`。
- 增加 wasm linker 流程。
- 增加 compile tests。

工程量：6-10 人周。

风险：

- Cangjie IR 中 runtime intrinsic 对 wasm target 的要求。
- exception、stack map、GC map、reflection intrinsic 的 target 支持。
- linker 和 sysroot 组织方式。

### Runtime Subset

任务：

- 定义 wasm runtime 初始化流程。
- 内存分配器适配 wasm linear memory。
- 字符串、数组、错误对象、基础类型 runtime 支持。
- panic / exception model。
- host import table。
- 禁用或替代动态加载、OS thread、native signal。

工程量：10-20 人周。

风险：

- GC / 对象生命周期。
- 栈扫描和异常展开。
- 与 Cangjie 语言语义的一致性。

### Standard Library Subset

任务：

- 基础 std subset。
- JSON / text / markdown 类库静态链接验证。
- fs/net/process/env/time/random capability adapter。
- browser host 和 Node host 差异处理。

工程量：8-16 人周。

风险：

- 标准库隐式依赖 OS。
- 依赖库使用 native FFI。
- WASI 与 browser capability model 差异。

### JS Host Runtime

任务：

- `@cangjielang/wasm-cj` loader。
- wasm module instantiate。
- import capability registry。
- memory read/write helper。
- handle table。
- event queue。
- async host call bridge。
- diagnostics / trace。

工程量：6-12 人周。

风险：

- WebAssembly import 默认同步，异步 host call 需要 continuation/polling/asyncify 风格设计。
- 大 buffer 传输需要避免频繁复制。
- 浏览器安全模型约束。

### Tooling 与 CI

任务：

- wasm target build job。
- smoke tests。
- ABI golden tests。
- size / startup / throughput benchmark。
- browser test runner。
- Node test runner。

工程量：4-8 人周。

风险：

- 工具链构建时间。
- 多平台 builder 一致性。
- benchmark 可重复性。

## 3. 推荐里程碑

| 里程碑 | 产物 | 验收 |
| --- | --- | --- |
| M0：LLVM target 验证 | cjc 产生 wasm object / module | hello function 可在 Node WebAssembly 调用 |
| M1：Runtime subset | wasm runtime init + memory allocator | 字符串和数组跨边界可用 |
| M2：Host ABI | JS import/export ABI | Cangjie 调用 `diagnostic.log`、`config.get` |
| M3：Data plane | pointer+length / handle table | 1MB buffer 不走 JSON |
| M4：业务库 PoC | Markdown/text module | markit 类能力在 wasm 中运行 |
| M5：ACEHarness adapter | `wasmRuntime=auto` | Node/Electron 中可选 wasm-cj 执行 |

## 4. 人力配置

推荐配置：

- 编译器工程师 1-2 人。
- runtime 工程师 1-2 人。
- JS/Node host 工程师 1 人。
- 标准库/业务库工程师 1 人。
- CI/测试工程师 0.5-1 人。

PoC 可由 2-3 人推进。MVP 需要 4-5 人并行。

## 5. 成本判断

最小可验证路径是 “纯函数 Cangjie -> wasm -> Node 调用”。这条路径可以快速验证 compiler target 和 JS host ABI。

产品化路径的主要成本集中在 runtime subset 和标准库裁剪，不在 JS loader。
