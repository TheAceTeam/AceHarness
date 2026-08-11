# Design Locks

Updated: 2026-08-11

## Terms And Boundaries

- A command is structured data: one executable plus an argv array. It is never a pre-quoted shell command line.
- An explicit ACP executable override is one executable reference, not a command line with arguments. An explicit path may contain legal filesystem characters, including cmd metacharacters; only a bare command is restricted to the safe command-name grammar.
- ACPX agents in scope are CodeAgent, NGA, and CodeGenie.

## Current Facts

- ACPX 0.13 rejects raw agent command strings on Windows and accepts argv-array registry overrides.
- ACPX itself owns `.cmd` and `.bat` handling when it receives an argv override.
- Existing CodeGenie override support is incomplete and duplicated across service and scripts.

## Migration Principles

- Registry metadata is the sole source of agent candidates, fixed ACP arguments, fallback candidates, and override environment-variable keys.
- Resolver precedence is explicit override, configured search paths, process PATH, then metadata fallback. An explicit override has no implicit fallback.
- Generic process execution uses `shell: false` for native executables. Only one dedicated launcher may invoke `cmd.exe` for `.cmd` or `.bat`.
- ACPX receives `[executable, ...args]` through registry overrides and receives an agent ID in `ensureSession`.
- Availability probe, model discovery, normal ACPX session startup, and diagnostic scripts must resolve the same command contract.

## Public Variables

- `ACEH_CODEAGENT_COMMAND`, `ACEH_NGA_COMMAND`, and `ACEH_CODEGENIE_COMMAND` are ACP executable/path overrides.
- Existing `ACE_NGA_SDK_*` and `ACE_CODEGENIE_SDK_*` variables remain SDK-specific and are not aliases.

## Do Not Add

- Do not pass a `cmd.exe /c ...` string to ACPX.
- Do not parse an override as a shell command line or silently execute embedded arguments.
- Do not delete a legacy scenario unless an equal-or-stronger replacement test covers it.
- Do not infer a PowerShell interpreter for `.ps1` files.
