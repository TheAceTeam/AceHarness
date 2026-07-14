# Recommended Implementation Order

1. Finish Task 1 first because every later task depends on stable runtime contracts and import boundaries.
2. Finish Task 2 next because orchestrator, API, adapters, and UI need durable runtime persistence.
3. Finish Task 3 and Task 4 after contracts because agent registry and model routes are independent but both feed runtime profile resolution. Parallel work is only allowed inside the currently active numbered task unless the user explicitly asks to pre-stage a later task.
4. Finish Task 5 before adapters execute real operations because permissions, env, secrets, and redaction affect adapter inputs and diagnostics.
5. Finish Task 6 after contracts, registry, model routes, and env profiles are usable.
6. Finish Task 7 after stores and adapters exist, because orchestrator coordinates both.
7. Finish Task 8 after orchestrator APIs can delegate to real runtime services.
8. Finish Task 9 after API DTOs stabilize enough to build client collections and query keys.
9. Finish Task 10 after client state exists, keeping UI changes incremental and consistent with existing pages.
10. Finish Task 11 only after runtime consumers no longer depend on old engine files or SDK packages.
11. Finish Task 12 as the final closeout after oldArchitecture removal. Earlier verification evidence can be recorded. 2026-07-09 exception: Task 12 verification scripts may close in parallel with Task 11 because the user explicitly allowed Task 11/12 to continue without blocking each other.

## Execution Gate

- Work on the lowest-numbered incomplete task first.
- Do not start implementation for a later task while an earlier task is below 100%, except for the explicit Task 11/12 parallel closeout allowance above.
- When a subagent finishes, audit its changed files and verification result before updating the README progress table.
- Only after the README marks the current task `100% / Done` can the next numbered task receive implementation work.
