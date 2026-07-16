---
name: csi-code-review
description: 用于基于真实 diff 审查实现是否满足 SDD、任务围栏、代码质量和 DT 约束时。
disable-model-invocation: true
metadata:
  pattern: code-review
---

# 代码审查

## 目标

独立检查真实代码变更的正确性、范围、安全性、性能、可维护性和测试完整性，输出有证据的 findings。代码审查维护 findings，实施评审负责准入裁决。

## 审查范围

### 1. 重建本次真实变更集

先读取 `implementation-summary.md` 中的变更基线、`pre_existing` 路径、Changed Files 和一次性例外记录。

Git 项目以记录的基线提交和当前工作树为两端，综合检查基线后的已提交、已暂存、未暂存、删除和未跟踪内容。可使用 `git diff <baseline>`、`git diff --cached`、`git diff`、`git status --short` 等仓库支持的命令交叉核对，并把结果与 Changed Files 对账。实施前已经存在且 hash/状态与基线证据一致的用户变更标为 `pre_existing`，不归因于本次运行；本次实施触碰或扩展的部分单独审查。

非 Git 项目依据实施前记录的存在性、hash 和 before snapshot，对照 Changed Files 和当前文件重建增量。无法还原精确差异时，明确记录可核验范围和证据限制；证据不足以独立判断范围或正确性时形成 blocking finding。实施阶段未采集或未保留证据时使用 `owner=implementation`；运行环境阻止证据采集或读取时使用 `owner=environment`。

### 2. 围栏合规性检查（高优先级）

从 `design.md` 读取五类围栏，从 `task.md` 读取每项变更授权，对真实变更集中的每个路径或符号生成围栏矩阵。状态只使用：

- `compliant`：由 task 授权，且属于 📦、✅ 或满足条件的 🔵；
- `authorized_exception`：存在当前 `run_id` 有效的一次性例外，实际修改严格落在其路径、符号和目的内，并且契约与 DT 影响均为 `none`；
- `violation`：目标属于 ❌、⚪、条件不成立的 🔵、未列出或未获得 task 授权，且没有有效例外；
- `evidence_limited`：现有证据无法确定实际范围或归因。

一次性例外需要同时核验例外 ID、运行 ID、精确范围、原类别、用户决定和回答证据、有效期、实际 diff，以及行为/契约/任务/DT 基线未变化。有效例外作为已解决的边界事项记录，不产生未关闭的 blocking finding。缺失、过期、跨运行、超范围或带有契约/DT 影响的记录按 `violation` 处理。

`violation` 形成 blocking finding：可以撤销或收敛实现时使用 `owner=implementation`；交付确实需要扩大设计或任务范围时使用 `owner=design`；验收事实或 DT 基线需要变化时分别使用 `owner=requirement` 或 `owner=dt`。`evidence_limited` 按证据缺失原因使用 `owner=implementation | environment`。

### 3. 详细变更检查

对每个变更文件检查：

- 对应 task、设计锚点和变更围栏；
- 主路径、错误路径、边界、状态和兼容行为；
- 与改动相关的权限、输入信任边界、敏感数据和资源释放；
- 与改动相关的并发、复杂度、I/O 和数据访问风险；
- 项目既有结构、命名、错误处理和可维护模式；
- DT Case、测试代码和 Green 报告是否真实覆盖相关行为；
- 新增文件、抽象和依赖是否具有任务来源与维护价值。

审查深度服从风险与改动规模。修订轮次以最新 diff 和未关闭 finding 为主，复核修复是否引入新问题。

## Finding 契约

每项 finding 包含：

- `id`；
- `severity`: blocking | major | minor；
- `dimension`: correctness | boundary | security | performance | maintainability | testing；
- 文件与符号位置；
- claim、evidence、impact、recommendation；
- `owner`: implementation | dt | design | requirement | environment；
- `resolution_status`: open | resolved。

## 产物契约

```yaml
---
ar_id: <AR-ID>
run_id: <runId>
artifact: code-review
status: reviewed
input_versions:
  design: <design.md updated_at>
  task: <task.md updated_at>
  dt_quality: <dt-quality-review.md updated_at>
  implementation: <implementation-summary.md updated_at>
  dt_post: <dt-test-report-post.md updated_at>
findings_status: open | resolved
updated_at: <ISO-8601>
---
```

正文包含基线与 diff evidence、`pre_existing` 归因、Changed Files 围栏矩阵、一次性例外核验、六维结论、findings、已解决项和证据限制。没有问题时明确记录未发现有证据的问题。
