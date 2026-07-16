---
name: csi-code-implementation
description: 用于根据已通过的 SDD、任务清单和 DT 实现前基线完成生产代码时。
disable-model-invocation: true
metadata:
  pattern: code-implementation
---

# 代码实现

## 目标

按 `design.md` 的目标与围栏、`plan.md` 的依赖顺序、`task.md` 的变更单元和已通过的 DT 基线完成生产实现。

## 执行方法

### 1. 固定输入与变更基线

1. 确认输入版本、当前 `run_id` 和 DT 质量评审为 `pass`；
2. 读取 `design.md` 的五类围栏和 `task.md` 的路径、符号、依赖及完成条件；
3. 在编辑前把变更基线写入 `implementation-summary.md`：
   - Git 项目记录 HEAD、分支、工作树状态、已有修改/删除/未跟踪路径；对任务目标和重叠脏文件同时保留内容 hash 与实施前 patch 或 before snapshot；
   - 非 Git 项目记录采集时间、计划目标是否存在、内容 hash 与可比较的 before snapshot；
   - 对实施前已经存在的用户变更标明 `pre_existing`，后续保留并与本次变更分别归因。

基线用于独立还原本次实施增量。执行过程中保留用户已有改动，在它们与任务目标重叠时基于基线做局部编辑并记录归因证据。

### 2. 选择当前任务

按 plan 波次和 task 依赖选择当前可执行任务，从任务声明的路径、符号和相邻实现模式读取必要代码。实现目标以已批准的行为、契约、任务和 DT 基线为边界。

### 3. 修改前授权判定

每个目标路径或符号必须同时满足：

1. 当前 task 明确授权该变更；
2. 目标属于 📦 新增、✅ 允许修改，或满足已写明条件的 🔵 条件修改。

判定结果按以下方式处理：

- 📦、✅ 或条件成立的 🔵：记录任务与围栏锚点后实施；
- ❌ 保护、⚪ 范围外或条件不成立的 🔵：暂停该修改，执行边界例外判定；
- 未列出的路径/符号或当前 task 未授权的目标：记录 `owner=design`、证据和所需边界，当前步骤设为 `blocked`，由设计与任务阶段补充正式授权。

### 4. 区分上游变更与单次边界例外

以下缺口改变已经批准的上游基线，记录证据并回流到对应职责：

- 公共或已批准的内部契约、数据结构/语义、权限或信任边界、兼容/迁移策略、错误或其他可观察行为发生变化：`owner=design`；
- 验收准则、任务范围或任务完成条件发生变化：根据来源使用 `owner=requirement` 或 `owner=design`；
- DT Case、断言、测试资产或基线需要变化：`owner=dt`。

发现任一上游缺口时停止受影响 task，并把实施状态设为 `blocked`；相应职责完成正式修订后再恢复。

单次边界例外只适用于一个已经由 task 授权、但被现有围栏分类限制的精确路径或符号，并同时满足：

- 已批准的行为、契约、任务完成条件和 DT 基线保持不变；
- 围栏内没有能够完成同一任务的安全方案；
- 请求范围可以精确到路径、符号和修改目的；
- 授权仅对当前 `run_id` 生效。

满足这些条件时，先在 `implementation-summary.md` 写入待决检查点，再使用 ACEHarness 运行时提供的步骤内人工客服协议请求一次性授权。问题正文说明已知事实、精确范围、必要性、已检查的替代方案和影响；每轮一个请求，发出后停止当前步骤。协议输出由 ACEHarness 运行时定义，本 Skill 只维护触发条件和问题内容。

恢复后记录授权证据。一次性例外至少包含：

- `exception_id`、`run_id`、精确路径/符号、原围栏类别和请求修改范围；
- 原因、已检查的替代方案、影响，以及 `contract_impact: none`、`dt_impact: none`；
- `decision`、用户回答证据、`answered_at` 和 `expires: current-run`。

获得授权后只实施记录中的精确范围。未获得授权时保持该边界不变；可行替代方案按原围栏实施，否则记录 `owner=design` 并阻塞。

### 5. 实施与验证

1. 实现满足设计契约和任务完成条件的最小变更；
2. 运行与本次编辑直接相关的编译、静态检查或快速检查；
3. 更新任务映射、实际变更、围栏判定和验证证据；
4. 逐个完成剩余任务，保持接口、迁移、兼容和回滚顺序；
5. 对照变更基线复核 Changed Files，区分本次增量与 `pre_existing` 用户改动。

实现优先复用现有模块、错误处理、配置和数据模式。新增文件或抽象记录其设计锚点和必要性。生产代码、运行配置、迁移与正式文档由 task 和围栏共同授权；测试资产修订通过 DT 回流重新建立基线。

所有 task 已完成、每项本次变更均为围栏合规或当前运行有效的一次性例外、快速检查有证据且没有上游缺口时，实施产物才设置为 `ready`。

## 产物契约

`implementation-summary.md` 使用：

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: implementation-summary
status: draft | blocked | ready
design_version: <design.md updated_at>
task_version: <task.md updated_at>
dt_quality_version: <dt-quality-review.md updated_at>
updated_at: <ISO-8601>
---
```

正文包含输入版本、变更基线与 `pre_existing` 路径、任务完成矩阵、Changed Files、逐项围栏判定、一次性例外记录、关键实现决策、迁移/兼容/回滚处理、快速检查命令与结果、未决问题和下一步 DT 执行清单。
