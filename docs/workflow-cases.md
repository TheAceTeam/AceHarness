# ACEHarness 工作流案例

本文收录 ACEHarness 工作流案例的完整复盘，包括问题背景、工作流结构、根因路径、修复策略、验证结果和执行数据。

### 案例总览图

![工作流案例总览](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflow-cases-overview.svg)

### 案例 1: Issue #3116 - 管道运算符重载 ICE: |> + lambda + 重载解析的 SIGSEGV

**场景**：仓颉编译器在管道运算符 `|>` 配合尾随 lambda 调用重载函数时触发 ICE（Internal Compiler Error），进程因 SIGSEGV（信号 11）崩溃，退出码 139。

**实际案例**：
- 社区问题：[Issue #3116](https://gitcode.com/Cangjie/UsersForum/issues/3116)
- 修复 PR：[cangjie_compiler#1405](https://gitcode.com/Cangjie/cangjie_compiler/pull/1405) ✅ 已合入
- 测试 PR：[cangjie_test#1387](https://gitcode.com/Cangjie/cangjie_test/pull/1387) ✅ 已合入

**触发代码**：
```cangjie
import std.collection.map
func test(input: Array<Float64>) { input |> map { p => f(p + 1.0) } }
func f(float: Float64) { float }
func f(int: Int64) { int }
main() { 0 }
```

**工作流结构**（状态机模式，5 个状态，最多 30 次状态转移）：

![管道运算符重载 ICE 修复](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflow-case-3116.svg)

<details>
<summary>展开完整案例复盘：触发条件、根因路径、修复方案与验证数据</summary>

#### 核心设计 1：四条件触发分析与最小复现

工作流首先通过变体测试确定触发 ICE 的充分必要条件，四个条件必须同时满足：
- **管道运算符 `|>`**：将表达式作为第一参数传递给右侧函数
- **尾随 lambda**：`{ p => ... }` 作为管道目标函数的额外参数
- **重载函数调用**：lambda 体内调用存在多个重载的函数 `f`
- **无类型标注的 lambda 参数**：`p` 未标注类型，需要编译器推导

对照用例：显式标注 lambda 参数类型时不崩溃（给出语义错误）：
```cangjie
func test(input: Array<Float64>) { input |> map { p: Float64 => f(p + 1.0) }}
```

#### 核心设计 2：精确定位崩溃代码路径

通过红蓝对抗式根因分析，精确定位崩溃路径：
```
TypeCheckLambda
  → TryEnforceCandidate (TypeCheckUtil.cpp:978)
    → PSet::clear()  ← 根因：销毁 log/stashes 检查点层，深度重置为 1
  → CommitScope 析构
    → PSet::apply()
      → stashes.back() 越界访问  ← SIGSEGV
```

- 总耗时 **约 5.5 小时**，完成 **8 次状态转移** / 30 次上限

**根因**：`TypeCheckUtil.cpp` 第 978 行，`TryEnforceCandidate` 函数中调用 `tyMgr.constraints[&tv].sum.clear()`。`PSet<T>::clear()` 是破坏性操作——它调用 `log.clear()` 和 `stashes.clear()`，将检查点深度重置为 1。然而同一约束（Bound）中的其他 PSet 成员（lbs、ubs、eq）仍保持原始深度（3+）。当 `CommitScope` 析构函数遍历所有约束并调用 `apply()` 时，深度为 1 的 sum 尝试访问 `stashes.back()`，但 stashes 已被清空或大小不匹配，导致越界访问 → SIGSEGV。

#### 核心设计 3：最小侵入性修复 — 保持检查点深度不变量

修复方案将破坏性的 `clear()` 改为逐个 `erase()` 循环：

```diff
-        tyMgr.constraints[&tv].sum.clear();
+        auto& sum = tyMgr.constraints[&tv].sum;
+        while (!sum.raw().empty()) {
+            sum.erase(sum.raw().begin());
+        }
```

**修复原理**：
- `clear()`：销毁 log/stashes，重置深度为 1 ❌
- `erase()` 循环：每次 erase 通过 `checkOut()` 记录到当前检查点，保持深度一致 ✅

语义上等价于 `clear()`（清空集合后由 `AddSumByCtor` 重新填充），但保留了检查点深度不变量。

#### 核心设计 4：全面验证 — ICE 消除 + 功能回归 + LLT 测试

**ICE 消除验证**：
- 原始复现（pipe + lambda + overload）：exit 139 → exit 1（语义错误）✅
- 最小复现 V17（无 pipe）：exit 139 → exit 1（语义错误）✅
- 三重载变体：exit 139 → exit 1（语义错误）✅

修复后编译器给出明确语义错误："parameters of this lambda expression must have type annotations"，而非崩溃。

**功能回归验证**：
- 管道运算符基本功能（`5 |> double`）：✅ 正常工作
- 函数重载解析（`f(1.0)` / `f(1)`）：✅ 正确解析
- 管道 + 无重载 lambda：✅ 正常工作
- 显式类型标注 lambda：✅ 正常工作

**LLT 测试套件**：240/240 通过
- 新增 ICE 测试（sema_lambda_overload_ice）：8/8 ✅
- 现有 overload 测试：15/15 ✅
- 现有 sema_test 诊断测试：35/35 ✅
- 现有 flow_expr 管道测试：23/23 ✅
- 现有 lambda 测试：74/74 ✅
- 现有 call 测试：85/85 ✅

**新增 8 个 LLT 测试用例**（`cangjie_test/testsuites/LLT/compiler/Diagnose/sema_test/sema_lambda_overload_ice/`）：
- case1.cj：原始复现（pipe + trailing lambda + 双重载）
- case2.cj：无 pipe（直接 lambda 赋值 + 双重载）
- case3.cj：三重载函数
- case4.cj：嵌套 lambda + 重载
- case5.cj：多参数 lambda + 重载
- case6.cj：链式管道 + 重载
- case7.cj：多重载 + 类型转换组合
- case8.cj：压力测试（深层嵌套 + 多重载）

#### 核心设计 5：根因分析的多轮迭代与条件性通过

工作流在根因分析阶段经历了 **6 次访问**（包含 2 次条件性通过），通过多轮迭代逐步收敛到精确的崩溃路径和根因。这体现了状态机工作流的自动回退与迭代能力，确保根因分析的准确性。

#### 执行数据

实际执行数据：

- 总耗时 **约 7.5 小时**，完成 **6 次状态转移** / 30 次上限
- **状态访问统计**：根因分析 6 次（含 2 次条件性通过）、修复实现 2 次、验证测试 2 次
- **代码改动**：-1/+3 行（`src/Sema/TypeCheckUtil.cpp`）
- **根因**：`TypeCheckUtil.cpp:978` 的 `PSet::clear()` 破坏检查点深度不变量
- **修复方案**：改用 `erase()` 循环保持检查点深度一致
- **验证结果**：
  - ICE 消除验证：3/3 通过（原始、最小、三重载）
  - 功能回归验证：4/4 通过（管道、重载、lambda、类型标注）
  - LLT 测试套件：240/240 PASS
  - 新增测试用例：8 个
  - 压力测试：4/4 通过（零崩溃）
- **状态**：✅ 已合入主分支

PR：https://gitcode.com/Cangjie/cangjie_compiler/pull/1405

</details>

### 案例 2: Issue #3112 - Extend ICE: 多继承路径成员合并的 SIGSEGV

**场景**：仓颉编译器在处理两个 extend 扩展同时扩展带同名成员函数接口时触发 ICE (Internal Compiler Error)，Windows 环境下错误码 11 (SIGSEGV)。

**实际案例**：
- 问题报告：[Issue #3112](https://gitcode.com/Cangjie/UsersForum/issues/3112)
- 修复 PR：[cangjie_compiler#1371](https://gitcode.com/Cangjie/cangjie_compiler/pull/1371) ✅ 已合入
- 测试 PR：[cangjie_test#1341](https://gitcode.com/Cangjie/cangjie_test/pull/1341) ✅ 已合入

**工作流结构**（状态机模式，7 个状态，最多 30 次状态转移）：

![Extend ICE 修复工作流](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflow-case-3112.svg)

<details>
<summary>展开完整案例复盘：复现条件、红蓝对抗、最小修复与回归验证</summary>

#### 核心设计 1：最小复现用例构造与触发条件确认

工作流首先构造最小可复现用例，通过变体测试确定触发 ICE 的充分必要条件：
- 两个 extend 扩展同一个类 `C<A>`
- 被扩展的接口存在继承关系（`I1<T> <: I0<T>`），且父接口 `I0` 含默认实现的成员函数 `f`
- 类型参数为复合泛型类型（如 `Option<A>`），而非直接的泛型参数 `A`

#### 核心设计 2：红蓝对抗式根因分析

- **Defender (code-hunter)**：深度分析 VTable 构建路径，定位到 `VTableGenerator.cpp:454-460` 的 step 3 缺陷
- **Attacker (code-auditor)**：独立验证根因假设，挑战是否存在其他 ICE 路径
- **Judge (fix-judge)**：综合双方分析，确认根因为 VTable 构建 step 3 缺少复合泛型类型的递归替换

#### 核心设计 3：最小侵入性修复方案

在根因明确后，改动控制在 **+1/-6 行**（`src/CHIR/GenerateVTable/VTableGenerator.cpp`）：
- 改用 `ReplaceRawGenericArgType` 递归替换，覆盖复合类型场景
- 使用项目中已有的成熟工具函数（86+ 处调用），是原逻辑的严格超集

#### 核心设计 4：多维度验证确保修复质量

- **ICE 消除验证**：8/8 通过（原始用例、反转顺序、嵌套泛型、多泛型参数等）
- **LLT 测试**：新增 `testExtend52.cj`，精确复现原始 ICE 场景
- **回归测试**：38/38 PASS（Extend/Generic/Class/Closure 等 6 套件）
- **压力测试**：24/24 通过（多泛型参数、深度嵌套、长继承链、混合继承等）

#### 核心设计 5：人工审查与回退机制

工作流在关键节点设置人工审批门，支持回退和反馈注入：
- 方案设计后人工确认是否进入代码修复
- 代码修复后人工决定是否继续迭代或接受结果
- 实际执行中**回退 2 次**（代码修复实现 → 人工审查），确保修复质量

#### 执行数据

实际执行数据（run-20260402）：

- 总耗时 **约 1 小时**，完成 **9 次状态转移** / 30 次上限
- **回退次数**：2 次（代码修复实现 → 人工审查）
- **状态访问统计**：人工审查 6 次（3 次人工决策）、代码修复 4 次、根因分析 2 次
- **代码改动**：+1/-6 行（`VTableGenerator.cpp`）
- **根因**：VTable 构建 step 3 缺少复合泛型类型的递归替换
- **修复方案**：改用 `ReplaceRawGenericArgType` 递归替换
- **验证结果**：
  - ICE 消除验证：8/8 通过
  - LLT 测试：新增 testExtend52.cj
  - 回归测试：38/38 PASS
  - 压力测试：24/24 通过
- **综合评分**：9.7/10
- **状态**：✅ 已合入主分支

PR：https://gitcode.com/Cangjie/cangjie_compiler/pull/1371

</details>

### 案例 3: AST 析构内存优化 -- 30% 内存峰值下降

**场景**：仓颉编译器在 AST 阶段结束后未及时释放内存，导致编译大型项目时内存峰值过高。

![AST 析构内存优化 SVG 配图](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflow-case-ast-memory.svg)

通过 Defender/Attacker/Judge 三角色多轮迭代，AI 分析了 AST 节点的生命周期，设计了分阶段释放策略。经过对抗式审查确认方案不会引入 use-after-free 等内存安全问题后，实施优化并验证。**最终实现编译期内存峰值下降约 30%**。

**工作流结构**（对抗式迭代，多轮 Defender / Attacker / Judge）：

![OpenHarmony 仓颉迁移 SVG 配图](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflow-case-ohos-migration.svg)

<details>
<summary>展开完整案例复盘：生命周期分析、内存风险审查与量化结果</summary>

#### 核心设计 1：基于 AST 生命周期的分阶段释放

AI 先梳理 AST 节点所有权与可见期，再设计「阶段结束后可安全释放」的粒度与时机，使优化目标（降峰值）与语义正确性约束对齐，而不是简单提前 `free`。

#### 核心设计 2：对抗式审查优先排除内存类缺陷

Attacker 侧重挑战「提前释放、双重释放、UAF」等路径；Judge 对是否可进入实现/合并给出结构化结论。通过多轮迭代，在动内存前尽量消化高风险质疑。

#### 核心设计 3：量化结果与人工基线对比

- **AI 辅助方案**：编译期内存峰值约 **下降 30%**
- **同一方向人工实现**：峰值约 **下降 70%**

差距说明当前 AI 在「更激进仍安全」的优化上仍有边界，适合作为**人工主导、AI 辅助**的参考案例，而非完全自主上限。

#### 执行数据

实际复盘（无独立 run 编号）：

- 优化类型：AST 阶段后内存释放与峰值控制
- 峰值收益（AI 方案）：约 **30%** 下降（相对优化前基线）
- 对照：人工实现约 **70%** 峰值下降，AI 方案更保守
- 风险管控：依赖蓝军挑战与**充分人工审查**；后续可结合知识库与提示词迭代缩小与人方案差距

</details>

### 案例 4: 仓颉鸿蒙 SDK API 开发 -- 从 Gap 分析到 API 文档的全流程自动化

**场景**：基于 OpenHarmony `@ohos.file.fs` 文件系统模块，开发对应的仓颉鸿蒙 SDK API。需求为：分析该模块全部 ArkTS API，按优先级排序后选取 3 个方法完成仓颉接口开发。

这个案例的核心价值在于：**AI 不只是写代码，而是完成了从需求澄清、Gap 分析、架构设计、跨语言编码、对抗式审查到标准 API 文档生成的完整软件工程闭环**。

**工作流结构**（状态机模式，7 个状态，6 个 Agent，最多 50 次状态转移）：

```
分析Gap → 架构设计 → 实现编码 → 蓝军审查 → 最终验证 → 生成API文档 → 完成
                       ↑  ↑        │          │
                       │  └─回退───┘          │
                       └──────── 回退 ────────┘
```

<details>
<summary>展开完整案例复盘：需求澄清、跨语言实现、蓝军验证与文档交付</summary>

#### 核心设计 1：AI 主动澄清需求，从源头避免返工

传统 AI 工具拿到需求就直接开始写代码。这个工作流中，Analyst Agent 在执行前**主动向用户确认关键决策**，而不是基于猜测开始工作：

- **优先级规则** -- Agent 主动提供 5 种候选策略（依赖优先 / 使用频率 / 复杂度递增 / 复杂度递减 / 自定义），引导用户做出明确选择
- **接口范围** -- 确认仅做同步方法还是同时包含异步，避免分析范围与用户预期偏离

用户确认后，后续 6 个步骤的执行方向从源头就是对的。这比「先猜后改」的模式节省了大量迭代成本。

#### 核心设计 2：三层跨语言 API 开发，AI 自主管理层间一致性

仓颉鸿蒙 SDK 的 API 开发不是单语言编码，而是需要**同时维护三层实现的一致性**：

| 层 | 语言 | 职责 |
|----|------|------|
| CJ SDK 声明层 | 仓颉 | 对外暴露的 API 签名（`file_fs.cj`） |
| CJ Wrapper 层 | 仓颉 | FFI 桥接函数声明（`file_ffi.cj`） |
| C++ FFI 层 | C++ | NAPI 调用封装 + FFI 导出（`file_impl.cpp` / `file_ffi.cpp`） |

AI 在这个流程中自主完成了三层代码的一致性开发：Gap 分析定位每一层的缺失状态，架构设计确定层间接口和结构体复用策略，编码实现同时修改 6 个文件（C++ 4 个 + 仓颉 2 个），编译验证确认跨语言链接正确（`llvm-nm -D` 验证 FFI 符号导出）。

#### 核心设计 3：蓝军按 NAPI 源码逐项交叉验证

蓝军审查不是泛泛的代码审查，而是**拿着 ArkTS NAPI 的源码逐个方法做行为对齐验证**。例如：

- 发现 `getxattr` 的错误处理语义差异：NAPI 对 `xAttrSize <= 0` 统一返回空串，CJ FFI 仅处理 `ENODATA`
- 发现 `lstat` 缺少 `file://` URI 解析：NAPI 有 `ParsePath()` 处理 URI scheme
- 发现 `BUILD.gn` 构建配置的条件反转和依赖缺失

这些不是语法错误或风格问题，而是**跨语言 API 开发场景下的语义级缺陷** -- 只有深度理解两套代码的行为才能发现。

#### 核心设计 4：真实编译验证，不是模拟

编译验证步骤配置了 `preCommands`，在真实的 OpenHarmony 构建环境中执行 `build.sh`。构建产物 `libcj_file_fs_ffi.z.so` 实际生成，`llvm-nm -D` 确认 26 个 FFI 符号全部以 `T`（全局可见）正确导出。

#### 核心设计 5：API 文档自动生成，闭环交付

流程的最后一步不是代码提交，而是通过 `cjcom gen --gen=md-sys` 自动生成标准格式的仓颉 API 文档（1961 行，32170 bytes），覆盖模块全部 func / class / struct / enum。开发者拿到的不只是代码，而是可以直接发布的 API 文档。

#### 执行数据

实际执行数据（run-20260323172056345）：

- 总耗时 **2 小时 5 分钟**，完成 **11 个步骤**，**10 次状态转移**
- 3 个 API 完成全栈开发（`lstatSync`、`mkdtempSync`、`getxattrSync`），C++ FFI 编译通过
- 注入 5 套专属 Skills，每个 Agent 携带仓颉/鸿蒙领域知识
- 产出 **11 份结构化文档**，涵盖 Gap 分析、架构设计、编码实现、编译验证、蓝军审查、评审裁决、最终审查、API 文档、产出汇总
- 全部产出写入运行记录的 `runs/{runId}/outputs/` 目录，全链路可追溯

</details>

---
