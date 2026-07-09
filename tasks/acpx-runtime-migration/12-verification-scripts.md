# Task 12: Verification, Scripts, And Migration Checks

Progress: 30%
Status: In Progress

## Goal

Update tests, check scripts, migration dry-run, diagnostics, and verification evidence for the completed runtime migration.

## Current State

- `package.json` still has check scripts named `check:engines`, `check:engine-chat`, and `check:acp`.
- Spec requires runtime availability, chat, session, trace, model route, and agent registry checks.
- The task list has no implementation verification yet.

## Follow-Up Work

- Add runtime check scripts and update package scripts.
- Add migration dry-run and consistency check scripts.
- Add redaction test vectors for API keys, Bearer tokens, private keys, stderr, tool IO, binding raw JSON, commands, and diffs.
- Run unit, component, API, and targeted static scans.
- Update this task list's verification log and gaps after each major milestone.

## Acceptance

- Check scripts use `agent/modelRoute/profile` rather than `engine/driver/model`.
- Migration dry-run reports plan, counts, warnings, errors, and legacy id map preview.
- Redaction tests fail closed on diagnostic bundle export.
- Final verification includes commands and summarized results in `verification-log.md`.

## Verification Record

- Assigned to subagent for TypeScript baseline gap cleanup; result pending.
- `npx tsc --noEmit --pretty false`: pass after baseline fixes in `WorkbenchClient.tsx` and `src/types/import-meta-env.d.ts`.
- Runtime target tests: pass, 7 files and 40 tests.
