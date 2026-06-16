---
name: aceharness-spec-coding
description: ACEHarness Spec Coding skill for generating, reviewing, revising, and executing spec-first requirements/design/tasks artifacts tied to workflow steps. Use when turning rough workflow requirements into actionable requirements.md, design.md, tasks.md, when revising AI-generated specs, or when keeping SpecCoding artifacts aligned with workflow execution.
---

# ACEHarness Spec Coding

Turn rough workflow intent into three executable planning artifacts:

- `requirements.md`: behavior contract and acceptance scenarios.
- `design.md`: implementation architecture, decisions, data flow, risks, and verification strategy.
- `tasks.md`: agent-sized executable tasks with R/D traceability and validation evidence.

Do not treat this as a formatting exercise. The output must give another AI agent enough context to implement, verify, and report progress without re-discovering the requirement.

## Artifact Boundary

- Write `requirements.md` as WHAT the system/user-visible workflow must do. Avoid internal class/function names unless they are part of a public interface.
- Write `design.md` as HOW the change will be organized technically. Include concrete modules, data contracts, state flow, migration/compatibility, risks, and trade-offs.
- Write `tasks.md` as DO. Each leaf task must have action, deliverable, validation, and precise requirement/design references.

If a detail is unknown but blocks implementation strategy, put it in clarification/open questions. If it does not block a conservative implementation, make a safe assumption and record it.

## Generation Procedure

1. Extract confirmed facts from user input, workflow config, existing spec, and code context.
2. Split the work into capabilities. A capability is a behavior or workflow outcome that can be tested independently.
3. Assign stable IDs:
   - requirements: `R1`, `R2`, ...
   - design decisions: `D1`, `D2`, ...
   - tasks: `T1`, `T1.1`, `T2.1`, ...
4. Write requirements first. Each requirement must include:
   - title and behavior boundary
   - user story or actor-goal-value sentence
   - at least two WHEN/THEN acceptance scenarios covering happy path and edge/error/compatibility path
5. Write design from the requirements. Include:
   - Mermaid architecture or sequence diagram
   - components/interfaces
   - data models/state and lifecycle
   - key decisions with alternatives
   - testing, compatibility, security/performance/reliability risks when relevant
6. Write tasks from requirements and design. Every executable leaf task must include:
   - action
   - deliverable
   - validation
   - `需求追踪：R...`
   - `设计追踪：D...` when a design choice governs the task
7. Self-check before returning:
   - no placeholders or generic filler
   - every requirement is referenced by at least one task
   - every task can be executed by a single agent
   - tasks preserve `spec-coding-task` comments if revising existing artifacts
   - language, terminology, IDs, and scope are consistent across all artifacts

## Requirements Rules

Required sections:

- `# 需求文档：<name>`
- `## 简介`
- `## 能力拆分`
- `## 术语表`
- `## 需求`
- `## 非目标`
- `## 待确认项`

Requirement block:

```markdown
### 需求 R1：<capability / behavior>

**能力边界：** <what is included and excluded>

**用户故事：** 作为<actor>，我希望<goal>，以便<value>。

#### 验收标准
1. WHEN <trigger/context> THEN <observable result>
2. WHEN <edge/error/compat context> THEN <observable result>
```

Rules:

- Use stable `R` IDs. Do not renumber existing IDs during revision unless explicitly renaming and recording why.
- Requirements are behavior contracts, not implementation steps.
- Include compatibility, permission, failure, or rollback behavior if relevant.
- Put unconfirmed facts in assumptions/open questions instead of presenting them as confirmed.

## Design Rules

Required sections:

- `# 设计文档：<name>`
- `## 概述`
- `## 架构` with fenced `mermaid`
- `## 组件与接口`
- `## 数据模型`
- `## 数据流`
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
    - 动作：<specific edits/research/build steps>
    - 交付：<files, config, docs, tests, or review result>
    - 验证：<command, test, manual review, or evidence>
```

Rules:

- Use checkbox tasks only. ACEHarness parses this format.
- Use two-space indentation per task level.
- Leaf task IDs must be unique and stable.
- Avoid vague tasks like "完善逻辑", "优化体验", "处理异常" unless the exact action and validation are listed below.
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
