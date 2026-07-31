# Task 3: Canonicalize And Lock Tasklist Skills

Status: Done

## Execution Contract

- Depends on: None.
- Unlocks: Tasks 4, 5, and 6.
- Execution: Parallel wave 1.
- Delegated owner: Child Agent C.
- Scope boundary: Own only `skills/aceharness-tasklist/`, skill registration/discovery references, tasklist-related docs/scripts, and `aceharness-workflow-creator` content/templates/check scripts. Do not edit application runtime, UI, or API routes.

## Goal

Keep `aceharness-tasklist` as the sole tasklist skill identity and define the directory-input contract required by lightweight workflows.

## Completed

- Updated source and discoverable tasklist-skill frontmatter, agent metadata, prompts, and display names to use `aceharness-tasklist`.
- Required a caller-specified `tasklistDirectory`; all tasklist artifacts are written there with no fallback, run-ID suffix, or external output directory.
- Limited the workflow-creator skill, prompt, templates, and focused check prompt to ordinary state-machine workflows and state terminology.

## Acceptance

- A repository-wide static search finds no retired tasklist identity.
- `aceharness-tasklist` documentation explicitly requires and honors a caller-specified document directory.
- The workflow-creator skill creates only normal state-machine workflows.

## Verification Record