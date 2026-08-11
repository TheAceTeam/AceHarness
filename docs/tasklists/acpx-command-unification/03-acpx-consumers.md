# Task 3: Migrate ACPX Consumers

Status: Complete

## Execution Contract

- Depends on: Task 2
- Unlocks: Task 5
- Execution: Parallel wave 2
- Delegated owner: Child agent, ACPX integration implementer
- Scope boundary: Own ACPX registry metadata, adapter/runtime/model-discovery/availability consumers, and ACPX-focused tests. Do not edit scripts or README files.

## Goal

Make ACPX lifecycle consumers use one resolved argv contract for CodeAgent, NGA, and CodeGenie.

## Follow-Up Work

- Completed: added `ACEH_NGA_COMMAND`, `ACEH_CODEAGENT_COMMAND`, and `ACEH_CODEGENIE_COMMAND` metadata to the runtime registry.
- Completed: moved NGA's `--disable-update acp` arguments into registry metadata and retained `ngagent -> nga` fallback.
- Completed: removed ACPX adapter Windows command wrapping and made model discovery/session startup use the agent ID plus argv registry overrides.
- Completed: availability probes now use the shared resolver and launcher.

## Acceptance

- Windows ACPX receives agent IDs plus argv-array overrides, never raw command strings.
- NGA fallback and fixed arguments follow the locked contract.
- All existing ACPX scenarios have equal-or-stronger replacement tests.

## Verification Record

- Passed: `npx tsc --noEmit --pretty false`.
- Passed: focused runtime-adapter, availability, registry, resolver, client availability, and environment-variable tests.
- Passed: ACPX registry smoke check confirms all three overrides are argv arrays.
