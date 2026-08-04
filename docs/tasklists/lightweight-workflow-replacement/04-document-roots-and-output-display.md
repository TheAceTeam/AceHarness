# Task 4: Document Roots And Output Display

Status: Done

## Execution Contract

- Depends on: Tasks 1 and 3.
- Unlocks: Task 7.
- Execution: Parallel wave 2.
- Delegated owner: Child Agent A or a new child after Task 1 review.
- Scope boundary: Own run document API, document client API types, DocumentsPanel, and document-root helpers only. Consume Task 1's persisted lightweight metadata; do not change schemas, state-machine manager, create/design UI, or Workbench integration.

## Goal

Show tasklist documents from the configured directory and persisted runtime output from the run directory, while removing all `.ace-outputs` support.

## Current State

- The documents route merges top-level `runs/<runId>/outputs` files with `<projectRoot>/.ace-outputs/<runId>` and assumes flat filenames.
- Tasklist artifacts require recursive paths and source-aware identity.

## Follow-Up Work

- Remove `.ace-outputs` resolution, reads, deduplication, PATCH, and DELETE handling. Do not delete existing user filesystem directories.
- For lightweight runs, resolve documents from persisted tasklist metadata; for all runs, retain persisted run outputs as an explicit output source.
- Implement recursive, containment-safe document traversal with relative POSIX paths, source identifiers, source-aware file keys, and safe rename/delete semantics.
- Update DocumentsPanel to display task documents and runtime outputs separately, preserving child-run source labels and drill-down behavior.
- Keep stream/live output separate from document enumeration.

## Acceptance

- No code reads `<projectRoot>/.ace-outputs/<runId>`.
- Lightweight tasklist directories with nested files are listable, previewable, and safely mutable through the document UI.
- Runtime output under the persisted run root remains visible as output, without being confused with tasklist documents.
- Path traversal, absolute paths, and cross-source filename collisions cannot escape the selected document root.

## Verification Record