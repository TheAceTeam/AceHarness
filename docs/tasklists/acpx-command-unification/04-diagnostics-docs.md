# Task 4: Unify Diagnostics And Documentation

Status: Complete

## Execution Contract

- Depends on: Task 2
- Unlocks: Task 5
- Execution: Parallel wave 2
- Delegated owner: Child agent, diagnostics and documentation implementer
- Scope boundary: Own diagnostic scripts, README.md, README.en.md, CLI environment-variable catalog, and documentation tests if needed. Do not edit ACPX runtime consumers.

## Goal

Remove the standalone script override policy and publish one accurate ACP executable override contract.

## Follow-Up Work

- Reuse the shared resolution path from diagnostics without duplicating bare-name overrides.
- Document three variables, precedence, accepted values, path-with-spaces examples, and SDK-variable boundary.
- Add CodeAgent and NGA entries to the settings environment-variable catalog.

## Acceptance

- Documentation and settings describe behavior implemented by Task 3 exactly.
- Diagnostic scripts cannot resolve a different executable from the service for the same environment.

## Verification Record

- Passed: `npx vitest run tests/cli-environment-variables.test.ts --reporter=dot`.
- Passed: direct Node smoke check imports `scripts/acpx-agent-overrides.mjs` and verifies argv overrides for `nga`, `codeagent`, and `codegenie`.
- Passed: focused ESLint for the diagnostic script, environment-variable catalog, and its test.
- Contract: the diagnostic script imports `getAcpxAgentRegistryOverrides` from the ACPX adapter through the project TypeScript runtime. It has no local candidate names or environment-variable handling, so it cannot select a different command policy than the service.
- Follow-up: Task 5 must prove explicit overrides and configured search paths through a real ACPX diagnostic session on each platform after Task 3 migration is complete.
