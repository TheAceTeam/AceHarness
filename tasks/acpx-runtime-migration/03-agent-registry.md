# Task 3: Agent Registry And Icons

Progress: 45%
Status: In Progress

## Goal

Create the runtime agent registry and persisted agent runtime state for core, verified, experimental, and hidden agents.

## Current State

- Existing icons under `public/engines` cover Claude, Codex, OpenCode, Cursor, Kiro, Trae, Code Agent, CodeGenie, and Magic.
- Spec requires `nga` and `codegenie` to be independent OpenCode-compatible agent ids.
- Missing experimental icons must not fall back to emoji.

## Follow-Up Work

- Implement built-in registry definitions for core/verified/experimental agents.
- Add command resolver fields for NGA and CodeGenie.
- Add SQLite-backed override, enabled/hidden, availability, env readiness, discovery, and capability probe state.
- Add availability probe API and registry tests.
- Add a generic SVG for experimental agents that lack specific assets, or list missing assets for design follow-up.

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
