# Task 5: Cross-Platform Integration Verification

Status: Complete locally; hosted CI pending

## Execution Contract

- Depends on: Task 3, Task 4, Task 6
- Unlocks: None known
- Execution: Serial integration task
- Delegated owner: Child agent, verification implementer
- Scope boundary: Own integration fixtures, CI configuration if present or required, and final test-suite updates. Do not redesign shared APIs.

## Goal

Prove that paths with spaces work across the service and ACPX on supported platforms.

## Follow-Up Work

- Add real temporary fixtures under paths containing spaces.
- Cover `.cmd` and `.bat` on Windows; native executable paths on Windows; executable POSIX fixtures on Linux/macOS.
- Exercise explicit override, configured path, PATH, fallback, missing command, availability API, generic launcher, registry override, model discovery, and session startup.
- Add or update CI matrix evidence for Windows, Linux, and macOS.

## Acceptance

- Windows integration is real, not only a mocked `process.platform` test.
- Every legacy scenario identified by Task 1 is preserved by an equal-or-stronger test.
- All focused tests, lint, and applicable cross-platform jobs pass.

## Verification Record

- Passed locally on Windows: `.cmd` and `.bat` fixtures below paths containing spaces, explicit override resolution for NGA/CodeAgent/CodeGenie, availability route, generic launcher, ACPX argv override, and model-discovery agent-ID contract.
- Passed: final `npm test` (`188 passed`, `1 skipped`, `1302 passed`, `7 skipped`).
- Added: `.github/workflows/acpx-command-cross-platform.yml` for Ubuntu, macOS, and Windows focused command-contract jobs.
- Remaining external evidence: hosted Linux/macOS workflow runs have not yet executed from this worktree.
