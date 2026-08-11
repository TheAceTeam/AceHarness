# Task 2: Implement Shared Resolution And Launch

Status: Complete

## Execution Contract

- Depends on: Task 1
- Unlocks: Task 3, Task 4
- Execution: Serial
- Delegated owner: Child agent, command-core implementer
- Scope boundary: Own shared resolver/launcher modules, `command-exists.ts`, `command-runner.ts`, and their focused tests. Do not migrate ACPX or scripts.

## Goal

Implement the structured resolver and one generic launcher without shell command strings.

## Follow-Up Work

- Completed: added `src/lib/core/resolved-command.ts` with `CommandSpec`, `CommandResolution`, `CommandAttempt`, resolver, generic launcher, probe, environment normalization, and ACPX argv conversion helper.
- Completed: migrated `command-exists.ts` to a compatibility wrapper over the resolver and `command-runner.ts` to the structured launcher. `resolveConfiguredCommand()` now exposes its `resolution` alongside the legacy `command` field.
- Completed: added focused resolver/launcher tests, including real temporary paths containing spaces and a Windows `.cmd` fixture on Windows.
- Follow-up for Task 3/4: ACPX, availability, model discovery, and scripts still use their legacy direct command paths and must consume this module before end-to-end convergence is claimed.
- Review follow-up: explicit filesystem paths must permit legal Windows filename characters such as `&`, `%`, `!`, and parentheses while bare commands remain restricted; add focused coverage before completion.

## Acceptance

- All resolver and generic-runner consumers can receive a structured result.
- Existing command-runner and command-exists behavioral scenarios remain covered.
- No generic Windows path uses a second shell-quoting layer.

## Verification Record

- 2026-08-11: `npx tsc --noEmit --pretty false` passed.
- 2026-08-11: `npx vitest run tests/core-command-resolution.test.ts tests/runtime-adapters.test.ts tests/api-engine-availability.test.ts tests/agent-registry.test.ts` passed: 4 files, 73 tests.
- 2026-08-11 review follow-up: `npx vitest run tests/core-command-resolution.test.ts` passed: 1 file, 11 tests; focused ESLint on `resolved-command.ts` and its test passed.
- The new focused suite verifies explicit executable paths containing spaces and legal cmd metacharacters, outer quote compatibility, no fallback after invalid explicit input, configured-search-path precedence, CR/LF and `.ps1` rejection, PATH/Path normalization, `--version` probe, and structured native launch.
