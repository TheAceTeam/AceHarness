# Memory V2 Out Of Scope

Updated: 2026-07-24

- Replacing the general run-state, event-store, or artifact persistence system with SQLite blobs.
- Adding a separate vector database, remote memory service, or cross-workspace semantic sharing in the first release.
- Allowing AI to bypass owner, visibility, governance, redaction, lifecycle, or audit checks.
- Treating workflow-start defaults as AI-owned memory. They remain explicit user configuration.
- Importing, summarizing, indexing, projecting, or using legacy SQLite/YAML/output memory as a V2 fallback.
- Retrofitting every historical raw run output into a memory detail record.
- Replacing the removed Agent-management memory editor with another per-Agent manual memory CRUD interface.
- Treating an arbitrary current Agent configuration, free-text channel label, or in-memory manager as authorization evidence for a memory read.
- Re-enabling legacy memory reads when V2 is disabled, or deleting legacy archive data as part of this feature.
