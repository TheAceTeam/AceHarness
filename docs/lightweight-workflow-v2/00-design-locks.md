# Design Locks

Updated: 2026-11-28

## Terms And Boundaries

- **Canvas document** means the editable graph used by the workflow design page. It contains node positions, visual metadata, graph edges, and execution references.
- **Execution configuration** means the existing workflow YAML/configuration consumed by the current runners.
- **Canvas IR** means the versioned internal graph representation between the editor and execution configuration. It is not itself a new runtime.
- **Agent node** means an execution step that invokes one configured Agent. Visual labels such as `AI agent`, `review`, and `delivery` are presentation categories, not separate runtime engines.
- **State group** means a state-machine container rendered on the same canvas. Its child nodes are the existing state steps.
- **Agent market** means a marketplace of validated Agent configuration bundles. It is a separate resource type from Skills, even when an Agent depends on Skills.

## Current Facts

- `src/lib/workflow/lightweight.ts` identifies the current lightweight profile and enforces the tasklist skill.
- The current lightweight schema requires exactly one state, one initial/final state, no transitions, exactly one Agent step, and rejects Script/Subworkflow steps.
- `src/lib/core/schemas.ts` already models Agent, Script, Subworkflow, parallel groups, concurrency metadata, and state-level review data for state-machine workflows.
- `src/components/StateMachineGraphPanel.tsx` and `src/components/StateMachineDiagram.tsx` already use the repository's `reactflow` package and existing React Flow styling.
- The pasted reference component uses a blueprint-style React Flow graph with custom cards, a right-side connection stack, bottom canvas controls, and an editable selected-node area.
- `src/types/marketplace.ts`, `src/lib/marketplace/sources.ts`, `src/lib/marketplace/provider.ts`, and the marketplace API routes already provide source configuration, provider dispatch, pagination, download, validation, and installation infrastructure for Skills.
- Agent configurations are currently stored as runtime YAML and managed through the existing Agent APIs and Agent manager.

## Migration And Implementation Principles

- Keep `workflow.mode` as the product/runtime compatibility discriminator: `lightweight` or `state-machine`.
- Add a versioned canvas document as an editor/compiler input. Do not make the editor write a second independent execution engine.
- Legacy configs without canvas metadata must be readable and synthesizable into a canvas graph.
- Every run must use an immutable compiled snapshot so later edits do not change an active run.
- 新轻量配置由版本化图定义。兼容范围是旧配置、历史和运行恢复，允许替换固定单步骤校验、隐式任务清单注入及旧工作台适配机制。
- Skill 转换与手工创建共用图契约和运行入口。转换产物先进入草案，来源变更只提示并提供差异和重新生成入口。
- 看板和运行画布从同一份运行快照、事件和已归属的任务证据读取状态。
- Lightweight expansion starts with a sequential DAG. Branch/join and actual parallel execution are separate capability gates and must reuse state-machine execution facilities.
- A lightweight canvas may contain a `subworkflow` node whose child is either another lightweight workflow or a state-machine workflow. The child is invoked as a bounded execution unit and is not flattened into the parent editor graph.
- Subworkflow references must be version/snapshot aware and form an acyclic dependency graph. Direct or indirect self-reference is invalid, and a configurable maximum nesting depth is required.
- State-machine states render as group/container nodes; existing state-level review, transition, parallel, and multi-step semantics remain authoritative.
- Reuse the existing `reactflow` package and React Flow providers. The pasted `@xyflow/react` component is a visual reference and an adaptation source, not a dependency mandate.
- Reuse the existing marketplace shell and source persistence. Agent repositories add a provider/resource type instead of duplicating Skill marketplace code.
- The Agent market is entered from the Agent page, next to local Agent management. The Skill market remains a Skill-only product surface; shared code is an implementation detail, not a combined navigation experience.
- Agent installation is atomic, provenance-aware, schema-validated, and reversible. A marketplace update must not silently overwrite a locally edited Agent.

## Do Not Add

- Do not introduce a third execution runtime merely to support the new canvas.
- Do not make lightweight workflows silently inherit state-machine-only review or parallel semantics.
- Do not flatten a subworkflow into the parent graph in a way that loses the child's run boundary, review policy, failure handling, or output contract.
- Do not copy the pasted component's remote logo URLs, inline demo state, or `@xyflow/react` dependency into production.
- Do not allow arbitrary repository post-install scripts or executable hooks as part of Agent installation.
- Do not merge Agent and Skill search results into one untyped result set.
- Do not overwrite an existing local Agent without an explicit replace/update decision and a recoverable backup.

## Example Or Documentation Rules

- Examples must show both the legacy one-node lightweight form and the new multi-node canvas form.
- Examples must label which fields are editor-only and which fields affect runtime execution.
- Agent repository examples must include a manifest, one Agent YAML, version metadata, and an optional Skill dependency; they must not rely on secrets embedded in the repository.
- All user-facing terms must go through the existing i18n system. Canvas visual labels are not a reason to add hard-coded English or Chinese strings.
