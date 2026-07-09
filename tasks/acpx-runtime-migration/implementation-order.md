# Recommended Implementation Order

1. Finish Task 1 first because every later task depends on stable runtime contracts and import boundaries.
2. Finish Task 2 next because orchestrator, API, adapters, and UI need durable runtime persistence.
3. Finish Task 3 and Task 4 in parallel after contracts because agent registry and model routes are independent but both feed runtime profile resolution.
4. Finish Task 5 before adapters execute real operations because permissions, env, secrets, and redaction affect adapter inputs and diagnostics.
5. Finish Task 6 after contracts, registry, model routes, and env profiles are usable.
6. Finish Task 7 after stores and adapters exist, because orchestrator coordinates both.
7. Finish Task 8 after orchestrator APIs can delegate to real runtime services.
8. Finish Task 9 after API DTOs stabilize enough to build client collections and query keys.
9. Finish Task 10 after client state exists, keeping UI changes incremental and consistent with existing pages.
10. Finish Task 11 only after runtime consumers no longer depend on old engine files or SDK packages.
11. Finish Task 12 throughout the migration, with final broad verification after legacy removal.
