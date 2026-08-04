# Current Verification Gaps

Updated: 2026-07-25

- Fresh-start initialization and legacy archive isolation have not been proven. Task 1 must add repeatable empty-store, schema-evolution, legacy-hash, and zero-access tests.
- Task 1 implementation has passed static Contract Gate A, but its canonical-path rejection, v3-to-v4 retrying migration, SQLite foreign-key rebuild, FTS lifecycle cleanup, participant/channel denial, and detail/manifest budgets have not been executed at runtime. This remains an explicit gap because build and test commands are out of scope for this workstream.
- The SQLite index/detail split, lifecycle anchor semantics, participant/channel authorization snapshots, handoff batch/receipt persistence, artifact references, and archive-registry contract are implemented but remain unproven at runtime. Tasks 1 through 4 must add focused coverage.
- The retention/scope/handoff/read-condition contract is statically implemented, but has no executed positive or negative coverage for short vs long lifecycle, anchor mismatch, run-wide cross-Agent short memory, each delivery mode, target selection, expected revision/fingerprint conflicts, index totals, or required-read acknowledgement/failure.
- AI native-tool and structured-result fallback parity is unproven. Static evidence covers Agent Chat and active workflow protocol execution; native callback providers, real `search -> read -> terminal proposal` continuation, terminal read/search rejection, stream cancellation, and lightweight tasklist/state-machine runtime behavior still need runtime proof.
- Same-state serial handoff, persisted channel membership, child handoffs, no-op, retries, cancellations, receipt failures, and resume are unproven. Static review confirms same-event proposal enforcement, atomic emission, and retry receipt reissue, but cannot prove their runtime behavior.
- Atomic handoff emission/replay and retry-target receipt reissue are statically accepted. SQLite transaction rollback, concurrent emit/retry races, frozen channel authorization, and migration behavior remain unproven.
- Chat compaction/recovery continuity across runtime session replacement is unproven. The runtime suite must cover persisted frontend-session creation, recovery, and owner mismatch paths.
- Static production scans no longer find legacy content readers in workflow status or Agent/configuration generation paths. Runtime zero-access telemetry must still prove that a V2-disabled or not-ready process cannot reveal or fall back to old memory/experience bodies.
- Agent-management memory UI removal, global governance lifecycle actions, long-memory review, audit visibility, accessibility, telemetry, required-read blocked-state UX, fresh-start enablement, and V2 disable/re-enable behavior are unproven at runtime.
- Governance and workflow-handoff pagination lack executed coverage for records beyond 10,000, invalid/repeated query keys, unsafe page values, and concurrent list mutation while following server `nextOffset`.
- No build or test command will be run in this workstream per user direction. Static code review can catch ownership and contract drift, but it cannot prove runtime SQLite, resume, authorization, or UI behavior; those risks remain explicit until a separately authorized verification pass.

## Must-Run Verification

- Focused SQLite fresh-start and Memory Service unit tests, including index/detail query separation, anchor isolation, participant/channel denial, atomic handoff/receipt writes, artifact path validation, legacy archive hashes, and zero legacy-content access.
- Focused Agent Chat, homepage chat, lightweight tasklist workflow, and state-machine handoff tests.
- Resume/retry/cancel/channel/subworkflow/required-read-failure integration tests.
- TypeScript validation and repository lint/test commands selected by the implementation tasks.
- Manual review of Agent management without memory CRUD, system governance/audit controls, workflow handoff panel, and permission-denied states.
