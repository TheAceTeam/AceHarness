---
name: aceharness-spec-coding
description: ACEHarness Spec Coding skill for generating, reviewing, revising, and executing spec-first requirements/design/tasks artifacts tied to workflow steps. Use when turning rough workflow requirements into actionable requirements.md, design.md, tasks.md, when revising AI-generated specs, or when keeping SpecCoding artifacts aligned with workflow execution.
---

# ACEHarness Spec Coding

Turn rough workflow intent into three executable planning artifacts:

- `requirements.md`: behavior contract and acceptance scenarios.
- `design.md`: implementation architecture, decisions, data flow, risks, and verification strategy.
- `tasks.md`: agent-sized executable tasks with R/D traceability and validation evidence.

Do not treat this as a formatting exercise. The output must give another AI agent enough context to implement, verify, and report progress without re-discovering the requirement or re-reading the whole codebase.

## Positive Example

When the request is vague, the generated spec feels generic, or the agent needs a concrete target for "executable enough", read `examples/executable-spec.md` before drafting. Use it as a style and granularity reference:

- split a vague feature into independently testable capabilities
- turn each capability into R requirements with actor value and observable WHEN/THEN outcomes
- derive design interfaces, data flow, decisions, alternatives, compatibility, and risks from those R requirements
- derive leaf tasks that a single agent can execute without re-asking what to do

Do not copy the example domain content unless the user's request is actually about non-stream chat env propagation.

## Evidence-First Rule

SpecCoding must start from evidence, not from a template.

Before drafting requirements/design/tasks, analyze the current system and write down:

- user intent: exact requested behavior, hard failures, non-goals, and implied compatibility constraints
- code evidence: files, functions, routes, schemas, tests, config keys, and runtime paths already found
- current behavior: what the existing code does today, including stream/non-stream or old/new path differences
- target behavior: what must change, what must stay unchanged, and what must fail loudly
- unknowns: only questions that affect implementation strategy; do not use unknowns to avoid making a conservative executable plan

If code context is available, every meaningful requirement and design decision should be grounded in at least one code artifact or workflow artifact. If code context is not available, explicitly mark the affected files/functions as "to be discovered" and create first tasks that discover them.

## Artifact Boundary

- Write `requirements.md` as WHAT the system/user-visible workflow must do. Avoid internal class/function names unless they are part of a public interface.
- Write `design.md` as HOW the change will be organized technically. Include concrete modules, data contracts, state flow, migration/compatibility, risks, and trade-offs.
- Write `tasks.md` as DO. Each leaf task must have action, deliverable, validation, and precise requirement/design references.

If a detail is unknown but blocks implementation strategy, put it in clarification/open questions. If it does not block a conservative implementation, make a safe assumption and record it.

## Generation Procedure

1. Build an analysis packet before writing final artifacts:
   - `Input Interpretation`: restate the user request as concrete behavior and failure semantics.
   - `Code Evidence`: list discovered files/functions/routes/types/tests and what each proves.
   - `Current vs Target`: compare current behavior and expected behavior in a small table.
   - `Impact Surface`: identify modules, APIs, data models, permissions, persistence, UI, tests, and migration risk.
   - `Error/Edge Matrix`: list important edge cases, expected result, and where they are handled.
2. Split the work into capabilities. A capability is a behavior or workflow outcome that can be tested independently.
3. Derive requirements from the analysis packet, not from section titles. Each R must answer:
   - who/what triggers it
   - what input/state is required
   - what observable output/state/error is produced
   - what must not change
   - how it can be tested
4. Assign stable IDs:
   - requirements: `R1`, `R2`, ...
   - design decisions: `D1`, `D2`, ...
   - tasks: `T1`, `T1.1`, `T2.1`, ...
5. Write requirements first. Each requirement must include:
   - title and behavior boundary
   - evidence from input/code
   - user story or actor-goal-value sentence
   - at least two WHEN/THEN acceptance scenarios covering happy path and edge/error/compatibility path
6. Write design from the requirements and code evidence. Include:
   - Mermaid architecture or sequence diagram
   - concrete components/interfaces/files/functions when known
   - data models/state and lifecycle
   - error propagation and hard-failure behavior
   - key decisions with alternatives
   - testing, compatibility, security/performance/reliability risks when relevant
7. Write tasks from requirements and design. Every executable leaf task must include:
   - action
   - deliverable
   - validation
   - target files/functions or a discovery target
   - expected test command or new test case
   - `需求追踪：R...`
   - `设计追踪：D...` when a design choice governs the task
8. Self-check before returning:
   - no placeholders or generic filler
   - every requirement is referenced by at least one task
   - every design decision is referenced by at least one task or explicitly marked as documentation-only
   - every task can be executed by a single agent
   - no task says "完善/优化/处理" without naming the exact code path, behavior, and verification
   - tasks preserve `spec-coding-task` comments if revising existing artifacts
   - language, terminology, IDs, and scope are consistent across all artifacts

## Requirements Rules

Required sections:

- `# 需求文档：<name>`
- `## 简介`
- `## 输入解读`
- `## 代码证据`
- `## 能力拆分`
- `## 术语表`
- `## 需求`
- `## 非目标`
- `## 待确认项`

Requirement block:

```markdown
### 需求 R1：<capability / behavior>

**能力边界：** <what is included and excluded>

**证据来源：** <user input / code file / route / function / test that justifies this requirement>

**用户故事：** 作为<actor>，我希望<goal>，以便<value>。

#### 验收标准
1. WHEN <trigger/context> THEN <observable result>
2. WHEN <edge/error/compat context> THEN <observable result>
```

Rules:

- Use stable `R` IDs. Do not renumber existing IDs during revision unless explicitly renaming and recording why.
- Requirements are behavior contracts, not implementation steps.
- Do not invent code facts. If the file/function is not checked yet, say `待勘探：<target>` and create a discovery task.
- Include compatibility, permission, failure, or rollback behavior if relevant.
- Put unconfirmed facts in assumptions/open questions instead of presenting them as confirmed.

## Design Rules

Required sections:

- `# 设计文档：<name>`
- `## 概述`
- `## 当前实现分析`
- `## 架构` with fenced `mermaid`
- `## 组件与接口`
- `## 数据模型`
- `## 数据流`
- `## 错误与边界矩阵`
- `## 关键决策`
- `## 测试方案`
- `## 兼容性与迁移`
- `## 风险与缓解`

Decision block/table must use stable `D` IDs:

```markdown
| 编号 | 决策 | 选择 | 理由 | 替代方案 |
| --- | --- | --- | --- | --- |
| D1 | <topic> | <choice> | <why> | <alternative and why not> |
```

Rules:

- Trace each meaningful design choice back to one or more `R` requirements.
- Prefer concrete local module/interface names only after checking code or workflow config.
- For each changed route/service/helper/adapter, state input contract, output contract, failure contract, and callers.
- Mention old data/config/API compatibility explicitly. If none, say why no migration is needed.
- Testing plan must cover main path, edge/failure path, and regression/compatibility risk.

## Tasks Rules

Required sections:

- `# 实现计划：<name>`
- `## 概述`
- `## 任务`

Task block:

```markdown
- [ ] T1 <phase/capability>
  - [ ] T1.1 <agent-sized task>
    - 需求追踪：R1
    - 设计追踪：D1
    - 目标文件：<file/function/module or discovery target>
    - 动作：<specific edits/research/build steps>
    - 交付：<files, config, docs, tests, or review result>
    - 验证：<command, test, manual review, or evidence>
```

Rules:

- Use checkbox tasks only. ACEHarness parses this format.
- Use two-space indentation per task level.
- Leaf task IDs must be unique and stable.
- Avoid vague tasks like "完善逻辑", "优化体验", "处理异常" unless the exact action and validation are listed below.
- Discovery tasks are allowed only when code evidence is truly unavailable. They must name search queries, expected files/functions, and the decision that depends on the discovery.
- Keep tasks aligned to workflow steps; do not bind every task to every requirement.
- Include at least one checkpoint task that summarizes verification evidence and remaining risks.

## Revision Protocol

When revising existing artifacts, do not rewrite freely.

1. Classify every requested change as `add`, `modify`, `remove`, or `rename`.
2. Identify affected targets by stable ID or section name: `R1`, `D2`, `T3.1`, `## 数据模型`.
3. Preserve unaffected blocks, numbering, task comments, and workflow step bindings.
4. If modifying a requirement, rewrite the full requirement block, not a fragment.
5. Keep the three artifacts synchronized:
   - requirement changed -> design and tasks must be checked
   - design changed -> affected tasks must reference the right `D` IDs
   - task changed -> requirement/design trace must still be valid
6. Return or record a revision plan:

```json
{
  "revisionPlan": [
    { "artifact": "requirements", "op": "modify", "targetId": "R1", "reason": "用户改变核心验收条件" },
    { "artifact": "tasks", "op": "add", "targetId": "T2.3", "reason": "新增回归验证任务" }
  ]
}
```

## Persistent Spec Mode

When `specCoding.persistMode: 'repository'`:

- `specCoding.specRoot` defaults to `<workingDirectory>/.spec`.
- `spec.md` is the master input; `checklist.md` stores unresolved review questions.
- Run delta snapshots live under `specs/<workflowName>-<runId>/`.
- When importing or merging persisted specs, preserve unaffected master sections.
- When runtime execution discovers drift, revise `requirements.md`, `design.md`, and `tasks.md` before continuing implementation.

## Quality Gate

A valid SpecCoding artifact set must pass these gates:

- requirements has title, glossary, capability/requirements section, user stories, and WHEN/THEN scenarios.
- design has architecture diagram, components/interfaces, data model, decisions, test plan, compatibility, and risks.
- tasks has parseable checkbox tasks, unique stable IDs, requirement trace, design trace when applicable, and validation details.
- no `<placeholder>`, TODO, TBD, or template residue remains.
- all three artifacts use the same language and terminology.
