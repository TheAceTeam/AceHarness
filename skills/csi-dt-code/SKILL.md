---
name: csi-dt-code
description: 用于根据已通过设计的 DT Case 生成真实测试代码并建立实现前执行基线时。
disable-model-invocation: true
metadata:
  pattern: dt-test-code
---

# DT 测试代码与实现前基线

## 目标

把 `dt-cases.md` 中的自动化验证义务转换为项目可发现、可执行的真实测试代码，并用本轮执行证据证明测试资产能够约束后续实现。

阶段合格结果可以是目标行为尚未实现形成的有效 Red，也可以是既有行为已经满足需求形成的经核验 Green。测试事实按 Case 逐项记录。

## 输入处理

使用 Workflow 提供的正式输入。先读取 SDD、DT Case 和上一轮质量反馈，再从设计声明的 test seam、任务落点和项目现有测试入口开始定向读取代码、构建文件与相关测试。实施回流存在时，按 `implementation-review.md`、`dt-test-report-post.md` 和 `code-review.md` 的原 finding ID 修订 `owner=dt` 的问题，并保留 design/requirement owner 供质量评审路由。

## 测试体系发现

按以下证据确定测试框架、目录、命名、fixture 和命令：

1. 相关现有测试及测试配置；
2. 构建文件和项目脚本；
3. CI 中实际使用的相关命令；
4. SDD 与 DT Case 已确定的验证入口。

优先复用项目现有体系。项目尚无测试体系时，只实现 `dt-cases.md` 已声明的最低测试能力：测试文件、测试配置、fixture、测试辅助代码、开发依赖和测试脚本，以及设计明确批准的非生产行为型 test seam。每项能力变更在摘要中记录文件、设计来源、用途和“生产行为影响：无”。需要改变生产行为才能建立验证入口时，记录 `owner=design` 的上游问题。

## 测试代码生成

为每个 `disposition=automated` 的 DT Case 建立稳定映射：

`需求/设计锚点 → Case ID → 测试文件 → 测试名称 → 核心断言`

测试代码满足：

- 采用项目已有结构、命名和断言风格；
- 断言观察 DT Case 定义的公开结果、状态、事件或契约；
- fixture 和 test double 位于可控边界，保留需要验证的核心行为；
- 关键 DT 保持启用并具有失败可见性；
- 测试辅助抽象服务于多个用例或显著降低重复；
- manual、alternative 和 not_applicable 项保留原处置与理由。

## 实现前基线执行

按成本从低到高执行并记录：

1. 测试发现、收集或编译检查；
2. 最小测试环境 smoke；
3. 新增 DT 的单文件或 Case 定向命令；
4. 完整新增 DT 集合；
5. 与目标模块直接相关且成本合理的既有测试。

每次修订重新运行受影响测试和完整 DT 集合。保存实现后能够复用的稳定测试清单与命令。

## Case 结果分类

- `valid_red`：测试被发现并执行，失败断言对应正式目标行为，测试代码、fixture 和环境正常，失败源于当前生产行为缺口；
- `valid_green`：测试被发现并执行，既有行为满足目标；同时用边界、反例、协议不变量或等价敏感性证据说明 Oracle 具备判别力；
- `invalid_test`：语法、导入、fixture、错误契约或弱 Oracle 等测试资产问题；
- `blocked_environment`：执行所需服务、权限、数据或运行环境当前不可获得；
- `pre_existing_failure`：与本次 DT 资产无因果关系的既有失败。

同一基线允许 Red 与 Green 混合，逐 Case 分类。`invalid_test` 在当前步骤修订；`blocked_environment` 记录恢复条件和复现命令；`valid_red` 作为后续实现输入。

## `dt-test-code-summary.md`

使用以下元数据：

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: dt-test-code-summary
status: draft | blocked | ready
dt_version: <dt-cases.md updated_at>
updated_at: <ISO-8601>
---
```

正文包含测试文件清单、每个测试文件的内容 hash、Case 映射、核心断言锚点、最低测试能力变更、fixture/test double 说明、稳定执行命令和非自动化处置。hash 使用项目可用的稳定内容摘要命令生成并记录命令。

## `dt-baseline-report.md`

使用以下元数据：

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: dt-baseline
status: blocked | ready
test_manifest_version: <dt-test-code-summary.md updated_at>
updated_at: <ISO-8601>
---
```

正文包含执行环境、实际命令、退出码、发现/通过/失败/跳过数量、逐 Case 分类、关键输出、带文件 hash 和断言锚点的稳定测试清单、相关既有失败和恢复条件。

所有自动化 Case 已映射并执行、测试自身有效、结果已分类且稳定清单完整时，两份产物设置为 `ready`。
