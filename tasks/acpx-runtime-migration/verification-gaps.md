# Current Verification Gaps

Updated: 2026-07-09

## Must-Run Verification

- `npm run lint`
- `npm test`
- Static scan for forbidden runtime imports from `src/lib/engines`.
- Static scan for provider/acpx native ids in ordinary DTOs, Query keys, and TanStack DB rows.
- Migration dry-run once schema migration exists.
- Real `AcpxRuntime` execution wiring is not implemented yet.

## Gaps

- acpx installed API surface has been inspected; Task 6 still needs real execution wiring through `AcpxRuntime`.
- Runtime SQLite schema has not been created or tested. Task 2 must close this.
- Redaction behavior has no test vectors yet. Task 5 and Task 12 must close this.
- UI integration has not been screenshot or component-tested. Task 10 must close this.
- Legacy SDK dependency removal cannot be verified until Task 11.
