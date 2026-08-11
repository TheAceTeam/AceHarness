# Recent Verification

Updated: 2026-08-11

## Baseline Audit

- Scope: command discovery and ACPX launch paths.
- Evidence: `command-exists.ts`, `command-runner.ts`, availability route, ACPX adapter/runtime client, diagnostic scripts, registry tests, and ACPX 0.13 distribution source.
- Result: partial. The audit established duplicated Windows shell construction and argv-array requirements; no implementation verification has run.
- Follow-up: Tasks 01 through 05.

## 2026-08-11 Task 01 Command Contract Investigation

- Status: design locked; no runtime files changed.
- Evidence reviewed: `command-exists.ts`, `command-runner.ts`, agent registry, ACPX adapter/runtime client, engine availability/model routes, `acpx-agent-overrides.mjs`, focused tests, and ACPX 0.13 distribution source.
- Locked: one structured `CommandAttempt`/`CommandResolution` contract; three ACP executable overrides; explicit override has no fallback; PATHEXT order; canonical PATH/Path; no command-line parsing; `.ps1` requires a future explicit interpreter feature; generic batch launch and ACPX argv launch remain separate terminal boundaries.
- Test preservation: Task 01 maps existing registry, override-cache, availability, and runtime-client tests, and adds real Windows `.cmd`/`.bat` fixtures beneath paths containing spaces.
- Verification: not run by design. Task 2 must compile and test the shared resolver/launcher before dependent migration.

## 2026-08-11 Task 02 Shared Resolution And Launch

- Status: complete. Added the shared structured resolver/launcher and migrated `command-exists.ts` plus `command-runner.ts`; no ACPX, route, script, or documentation consumer was migrated in this task.
- Windows boundary: native commands use structured `spawn(..., { shell: false })`; only `resolved-command.ts` builds the internal `cmd.exe /d /s /c` argv for `.cmd`/`.bat`.
- Compatibility: `findCommand()` remains available as a string-returning wrapper. `resolveConfiguredCommand()` retains `command` and adds `resolution` for callers ready to consume diagnostics/argv.
- Verification passed: `npx tsc --noEmit --pretty false`; focused Vitest run of `core-command-resolution`, `runtime-adapters`, `api-engine-availability`, and `agent-registry` (4 files, 73 tests); focused ESLint on Task 2 files.
- Review follow-up passed: opaque paths now accept legal Windows filename characters such as `&`, `%`, `!`, and parentheses; a real `&`/parentheses fixture resolves successfully. `npx vitest run tests/core-command-resolution.test.ts` (11 tests) and focused ESLint passed.

## 2026-08-11 Task 04 Diagnostics And Documentation

- Status: complete. `scripts/acpx-agent-overrides.mjs` delegates override construction to the ACPX adapter through the local TypeScript runtime instead of maintaining an independent bare-command implementation.
- Published contract: `ACEH_NGA_COMMAND`, `ACEH_CODEAGENT_COMMAND`, and `ACEH_CODEGENIE_COMMAND` are documented in Chinese and English README files and added to the CLI environment-variable catalog. Documentation defines explicit-override precedence, a single executable/path value, Windows paths containing spaces, and the boundary from NGA/CodeGenie SDK variables.
- Verification passed: `npx vitest run tests/cli-environment-variables.test.ts --reporter=dot`; direct Node diagnostic-override smoke check; focused ESLint on Task 4 source and test files.
- Follow-up: Task 5 must exercise the diagnostic script with Task 3's final resolver against real Windows batch fixtures and POSIX space-containing executable paths.

## 2026-08-11 Tasks 03, 05, And 06 Completion

- Scope: ACPX consumer migration, engine-page refresh isolation, and cross-platform command verification.
- Evidence: registry metadata now owns all three ACP override keys and NGA arguments; ACPX model/session paths pass agent IDs and registry argv overrides; availability uses `resolveCommand` plus `probeCommand`; card refreshes call a single-engine mutation and merge only that report.
- Result: local pass. Final `npm test` completed with 188 files passed, 1 skipped, 1302 tests passed, and 7 skipped. Focused TypeScript, ESLint, runtime/availability/resolver/client tests, and diagnostic-script smoke checks passed.
- Follow-up: hosted Ubuntu/macOS/Windows jobs are defined in `.github/workflows/acpx-command-cross-platform.yml`; only hosted execution evidence remains.
- Full lint passed with 0 errors and 6 pre-existing warnings outside this task's files.
