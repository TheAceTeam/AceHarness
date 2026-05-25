# wasm-cj 可行性分析

## 1. 目标形态

`wasm-cj` 输出一个 Cangjie WebAssembly 业务模块：

```text
Cangjie source
  -> Cangjie frontend
  -> LLVM IR / bitcode
  -> LLVM WebAssembly backend
  -> .wasm
  -> JS host runtime
```

JS host 负责加载 `.wasm`、提供 import capability、管理线性内存、派发事件和转换数据。

## 2. 编译器可行性

可用基础：

- Cangjie native backend 已经使用 `opt` / `llc`。
- LLVM 支持 WebAssembly target。
- 编译器 driver 已经有 backend/toolchain 抽象。

需要新增：

- LLVM 构建加入 `WebAssembly` target。
- target triple 支持 `wasm32-wasi`、`wasm32-unknown-unknown` 或专用 `wasm32-cangjie`。
- 新增 `CJWASMBackend` 或扩展 backend 分发。
- 新增 wasm toolchain，生成 `.wasm` 或 `.o` + wasm linker 输出。
- 新增 wasm linker 参数、sysroot、runtime library 搜索路径。
- 新增 wasm output mode、artifact layout、测试基线。

## 3. Runtime 可行性

wasm-cj runtime 有两种路线：

| 路线 | 描述 | 优点 | 代价 |
| --- | --- | --- | --- |
| Runtime subset | 为 wasm 定义 Cangjie runtime 子集 | 可控、适合浏览器、启动快 | 标准库和语言能力需要裁剪 |
| Full runtime port | 把完整 runtime 适配到 wasm / WASI | 语言兼容性强 | 工程量大，线程/GC/异常/动态加载复杂 |

推荐目标是 Runtime subset：

- 无动态库加载。
- 单 wasm module 或少量静态链接 module。
- 以线性内存承载业务数据。
- JS host 提供 I/O capability。
- GC 与对象管理封装在 wasm module 内。
- ABI 边界只传 number、pointer、length、handle。

## 4. 标准库可行性

标准库按能力分组：

| 能力 | wasm-cj 策略 |
| --- | --- |
| 基础类型、集合、字符串 | 编译进 wasm runtime subset |
| JSON、Markdown、解析类库 | 可静态链接进业务 wasm |
| 文件系统 | 通过 host capability 或 WASI |
| 网络 | 通过 host capability |
| 进程、shell | 浏览器禁用，Node host 可显式开放 |
| 时间、随机数、环境变量 | host import |
| 线程、锁、并发 | 单线程基线，线程作为独立扩展 |
| 动态加载 | 不作为 wasm-cj 基线能力 |

## 5. ACEHarness 可行性

ACEHarness engine 场景适合 wasm-cj 的部分：

- Markdown 解析、生成和标准化。
- JSON / 协议转换。
- prompt preprocessing。
- 纯计算型 result normalization。
- 可 sandbox 的 provider 逻辑。

不适合直接放进 wasm-cj 的部分：

- 长生命周期 native process 管理。
- 直接调用本机 SDK 动态库。
- 直接访问 shell、文件系统、网络。
- 依赖 Cangjie 完整 runtime native API 的能力。

## 6. 结论

`wasm-cj` 适合作为长期后端。落地关键不是 LLVM 是否能生成 wasm，而是 Cangjie runtime subset、标准库 capability 切分、host ABI 和工具链工程。

推荐技术路线：

1. 建立 wasm target 与 minimal runtime。
2. 跑通纯函数 Cangjie module 到 Node WebAssembly。
3. 定义 JS host import/export ABI。
4. 接入 JSON、Markdown、文本处理类业务库。
5. 扩展到 ACEHarness engine 的可沙箱业务逻辑。
