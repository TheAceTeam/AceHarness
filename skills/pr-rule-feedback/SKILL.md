---
name: pr-rule-feedback
description: >-
  黄军 Judge：从红军/蓝军上下文复核 review 结论是否成立，给出规则修改建议，POST rule-feedback-reports。
  输入多为对话上下文；模型自行加载相关文件；可运行于任意 Agent 环境。
---

# 黄军规则反馈

对蓝军 review 结论做**独立第三方复核**：确认 issue 是否真实、是否误报，产出规则修改建议并上报。

## 路径约定

| 变量 | 含义 |
|------|------|
| **SKILL_ROOT** | 本 skill 包根目录（含 `SKILL.md`） |
| **WORK_DIR** | 黄军产出目录，默认 `judge_tmp`（仅写 `feedbacks.json`） |
| **脚本** | `{SKILL_ROOT}/scripts/report_feedback.py`（仅上报） |
| **规则库** | `{SKILL_ROOT}/rules_registry.json`、`rules/cards/{rule_id}.md` |

---

## 输入来源

Judge 输入来自 **ACEHarness 工作流注入**、**蓝军 review 产物** 与 **对话上下文**。推荐先跑 `prepare_judge_context.py` 汇总，再 Read 细节；脚本失败时再手工加载下表路径。

### ACEHarness 工作流（优先）

| 来源 | 路径 / 形态 | 提取什么 |
|------|-------------|----------|
| **前序步骤产出** | Prompt 中 `## 前序步骤产出` / `# 前置步骤结论` | 蓝军步骤摘要、`runs/{runId}/outputs/*.md` 完整路径 |
| **runs 归档** | `{workspaceData}/runs/{runId}/outputs/{步骤名或状态-步骤}.md` | `<step-conclusion>`、embedded `issues` JSON |
| **状态机同状态** | 文件名形如 `实施-代码审查.md` | 上一步蓝军在同状态内的归档（Judge prompt 未必自动注入全文，需 Read） |
| **阶段模式** | 文件名形如 `代码审查.md` | 同迭代内已完成蓝军步骤产出 |

工作流 `{runId}` 与 outputs 绝对路径见当前步骤 Prompt 的「文档输出要求」或前序步骤中的 `` `.../outputs/...` ``。

### 蓝军 review 产物（pr-hard-review-report）

| 优先级 | 路径（相对被 review 仓库根） | 用途 |
|--------|------------------------------|------|
| 1 | `review_tmp/issues.json` | 蓝军结构化 issues（**首选**） |
| 2 | `review_tmp/review.diff` / `review_tmp/pr.diff` | 完整 diff |
| 3 | `review_tmp/selected_rules.md` | 蓝军选用的规则摘要 |
| 4 | `review_tmp/review_context.json` | `changed_files` 等元数据 |

### 对话与源码（补全）

| 来源 | 提取什么 |
|------|----------|
| **红军** | 改了哪些文件、diff 或 before/after 片段 |
| **蓝军对话** | issues 列表、rule_id、file、line、problem |
| **规则卡片** | `{SKILL_ROOT}/rules/cards/{rule_id}.md` |
| **源文件** | issue 指向的 `file`/`line` 附近 |
| **git** | diff 缺失时 `git diff` / `git show` |

**必须先有：可复核的 issues 列表（或已确认蓝军零 issues）+ 代码证据（diff / 源文件 / 对话片段）。**

- `issues` 为空且无法确认蓝军已执行 review → verdict `fail`，说明缺少输入
- `issues` 为空且已确认蓝军零检出 → 可 `feedbacks: []`，verdict `pass`
- `diff` 为空 → 继续 Read 源文件，勿仅凭 `problem` 文本判成立

---

## 全流程

```mermaid
flowchart LR
  A[自行加载上下文与文件] --> B[四步复核]
  B --> C[feedbacks.json]
  C --> D[report_feedback.py]
  D --> E[rule-feedback-reports]
```

---

## 阶段一：整理输入

1. 阅读 [judge_prompt.md](judge_prompt.md)。
2. **（推荐）** 在被 review 仓库根或工作目录执行：

```powershell
cd <被-review-的-仓库根或 ACEHarness 工作目录>

python "<SKILL_ROOT>/scripts/prepare_judge_context.py" `
  --repo . `
  --run-outputs-dir "<runs/{runId}/outputs 绝对路径>" `
  --blue-step-keys "<蓝军步骤归档名,可选>" `
  --blue-step-substring "审查" `
  --work-dir judge_tmp `
  --json
```

脚本写出 `judge_tmp/judge_context.json`（含 `issues`、`blue_team_outputs`、`review_artifacts`、`warnings`）。**以 stdout 打印的路径为准。**

3. Read `judge_context.json`，再按需加载：Prompt 前序产出 → `review_tmp/*` → 各 `rule_id` 规则卡片 → issue 源文件。
4. 归纳：**改了什么、蓝军用了哪些规则、报了哪些问题**；证据不足时用 `git diff` 或 Read 补读。

---

## 阶段二：复核判定

阅读 [judge-examples.md](judge-examples.md)。

`rule_id` 须来自 `{SKILL_ROOT}/rules_registry.json`。

### 四步复核（每条蓝军 issue）

```
相关性 → 证据 → 因果 → 误报边界
```

**每次复核须覆盖写入** `judge_tmp/feedbacks.json`（勿追加历史内容）。空白结构见 `{SKILL_ROOT}/templates/feedbacks.template.json`。

```json
{
  "summary": "共复核 2 条 issue，1 条成立，1 条误报",
  "feedbacks": [
    {
      "rule_ids": ["style-naming-c24e74ff15fe"],
      "content": "判定：成立。…规则修改：…",
      "agent": true,
      "source_issues": [0]
    }
  ]
}
```

| 字段 | 必填 |
|------|------|
| `content` | 是（判定 + 理由 + 规则修改建议） |
| `agent` | 是（黄军固定 `true`） |
| `rule_ids` | 推荐 |

`feedbacks: []` → 跳过上报。

---

## 阶段三：上报（脚本）

```powershell
python "<SKILL_ROOT>/scripts/report_feedback.py" judge_tmp/feedbacks.json
```

校验：

```powershell
python "<SKILL_ROOT>/scripts/report_feedback.py" judge_tmp/feedbacks.json --dry-run
```

**防重复上报**：上报成功后脚本自动**刷新** `feedbacks.json`——全部成功则清空为 `{"summary":"","feedbacks":[]}`；部分失败则仅保留未成功条目供重试。`--dry-run` 不修改文件。

### 接口

`POST https://opencsitool.com/opencsitool/api/v1/rule-feedback-reports`

```json
{
  "rule_ids": ["style-naming-c24e74ff15fe"],
  "content": "判定：成立。变量名不符合命名规范。规则修改：…",
  "agent": true
}
```

无 HTTP 认证；HTTPS 默认跳过证书校验。

---

## 执行清单

```
输入
[ ] prepare_judge_context.py（含 --run-outputs-dir / --blue-step-substring）
[ ] Read judge_tmp/judge_context.json
[ ] 读 Prompt 前序步骤产出（若有）
[ ] 读 review_tmp/issues.json、review.diff、selected_rules.md
[ ] 读 rules/cards/{rule_id}.md 与 issue 源文件
[ ] diff 不足时用 git / Read 补证据

复核
[ ] judge_prompt.md 四步复核每条 issue
[ ] 覆盖写入 judge_tmp/feedbacks.json（agent: true，勿沿用旧内容）

上报
[ ] report_feedback.py judge_tmp/feedbacks.json（成功后自动清空/刷新）
[ ] 向用户汇报 OK/WARN
```

---

## 安装与自检

```powershell
pip install -r "<SKILL_ROOT>/requirements.txt"
python "<SKILL_ROOT>/scripts/validate_skill_bundle.py"
```

---

## 附录

| 文件 | 说明 |
|------|------|
| [judge_prompt.md](judge_prompt.md) | 复核角色与输出格式 |
| [judge-examples.md](judge-examples.md) | feedback 示例 |
| [rules.md](rules.md) | 规则索引 |
| `templates/feedbacks.template.json` | 空白 feedbacks 模板 |
| `checkpoint_rules.json` | 规则溯源 |
| `rules/search_index.json` | 规则检索索引 |
| `prepare_judge_context.py` | 从 ACEHarness outputs + review_tmp 整理 judge_context.json |
| `report_feedback.py` | 批量 POST 上报并刷新 feedbacks.json |
