# Current Verification Gaps

Updated: 2026-07-09

## Must-Run Verification

- `npm run lint`
- `npm test`
- Real process-level `AcpxRuntime` execution has not been proven yet.

## Gaps

- acpx installed API surface and client translation are covered by focused tests; Task 6 still needs process-level real-agent execution proof.
- Runtime SQLite schema/store Task 2 is complete at the focused store level; later orchestrator work may choose when to call explicit lease reclaimer versus the existing compatible claim recovery path.
- Runtime-first check scripts, static runtime boundary scans, migration dry-run, and consistency checks pass. `check:runtime:chat` still proves adapter skeleton behavior only; it does not yet exercise real process-level `AcpxRuntime` execution.
- `/api/runtime-sessions/*` routes and SQLite-backed default service have targeted tests for session/turn/events/cancel/compact/fork/traces/diagnostics and owner/admin authorization.
- Diagnostic bundle fail-closed vectors now cover API keys, Bearer tokens, private keys, stderr/stdout/tool IO, binding raw JSON, commands, and diffs; future runtime payload shapes still need matching vectors when introduced.
- UI migration acceptance is closed by focused tests, TypeScript, and structural review. Browser screenshot coverage is still useful for future visual regression work but is no longer blocking Task 10.
- oldArchitecture SDK dependency removal cannot be verified until Task 11.
- Migration dry-run reports two warnings for oldArchitecture `magic-cli` model routes in `configs/models/models.yaml`; they import successfully but do not map to a builtin runtime agent id. This is data cleanup, not a Task 12 script blocker.
