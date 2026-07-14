# Task 3: Agent Registry And Icons

Progress: 100%
Status: Done

## Goal

Create the runtime agent registry and persisted agent runtime state for core, verified, experimental, and hidden agents.

## Completed

- Existing icons under `public/engines` cover Claude, Codex, OpenCode, Cursor, Kiro, Trae, Code Agent, CodeGenie, and Magic.
- Built-in registry definitions cover core, verified, experimental, and hidden/discovered agents.
- `nga` and `codegenie` are independent OpenCode-compatible agent ids with distinct command/session scope.
- Core and verified agents use local SVG/PNG icon paths.
- Experimental agents use local icons or the local generic provider icon; emoji fallback is not used.
- SQLite-backed runtime state covers override, enabled/hidden, availability, env readiness, discovery, and capability probe state.
- `/api/agents` returns merged runtime registry entries and preserves oldArchitecture consumer fields such as `name`, `title`, `activeEngine`, `engineModels`, and `capabilities`.

## Follow-Up Work

- Watch for any old UI consumer that depended on raw YAML-only `_file` shape; common oldArchitecture list fields are preserved.

## Acceptance

- `/api/agents` can return merged `AgentDefinition + AgentRuntimeState` without hard-coded UI capabilities.
- Core/verified agents have local SVG/PNG icons.
- Experimental agents never render emoji fallback.
- NGA and CodeGenie use distinct agent ids and session scopes.

## Verification Record

- `npm install`: pass. Dependencies installed before implementation dispatch.
- Assigned to subagent Volta for implementation; result pending.
- `npx vitest run tests/agent-registry.test.ts`: pass.
- `npx vitest run tests/runtime-contracts.test.ts tests/runtime-sqlite-schema.test.ts tests/agent-registry.test.ts`: pass, 17 tests.
- `npx tsc --noEmit --pretty false`: fail only on existing/non-Task-3 errors in `WorkbenchClient.tsx` and `src/start.ts`.
- 2026-07-09 Task 3 closeout worker:
  - `npx vitest run tests/agent-registry.test.ts tests/api-agents-runtime-registry.test.ts`: pass, 7 tests.
  - `npx tsc --noEmit --pretty false`: pass.
  - Verified merged runtime registry output, SQLite runtime state read/write, command resolver probe specs, local icon assets, hidden discovered agents, and independent NGA/CodeGenie OpenCode-compatible ids.
