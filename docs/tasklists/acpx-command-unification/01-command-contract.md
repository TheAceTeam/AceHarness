# Task 1: Establish the Command Contract

Status: Design locked; implementation pending

## Execution Contract

- Depends on: None
- Unlocks: Task 2
- Execution: Serial
- Delegated owner: Child agent, command-contract investigator
- Scope boundary: Inspect and define the shared TypeScript API and migration map. Do not modify runtime behavior in this task.

## Goal

Lock a compile-ready structured command API, resolver precedence, Windows file-kind policy, and preserved test scenarios.

## Current State

- `findCommand()` returns only a string and callers reconstruct arguments independently.
- CodeAgent, NGA, and CodeGenie have duplicated special cases in ACPX adapter code.
- `command-runner.ts`, engine availability, and `acpx-adapter.ts` each build a different Windows shell string. The ACPX adapter turns argv into `cmd.exe /c` and quotes it again.
- ACPX 0.13 accepts argv-array registry overrides and rejects raw agent command strings on Windows, but model discovery may still create a raw string. ACPX already owns `.cmd`/`.bat` handling for its argv overrides.
- CodeGenie alone has `ACEH_CODEGENIE_COMMAND`; scripts maintain a reduced duplicate override map; the settings registry and READMEs do not cover the analogous CodeAgent/NGA ACP executable configuration.
- Registry metadata says NGA is `ngagent acp` with fallback `nga`; the ACPX adapter actually adds `--disable-update`. This must move into metadata.

## Locked Shared API

Task 2 creates one server-side module (suggested: `src/lib/core/resolved-command.ts`). No type may contain a pre-quoted shell line.

```ts
export type CommandSource = 'explicit' | 'configured-path' | 'PATH' | 'fallback' | 'unresolved';
export type CommandFileKind = 'native' | 'cmd' | 'bat' | 'ps1' | 'unknown';

export type CommandCandidate = {
  executable: string;
  source: Exclude<CommandSource, 'unresolved'>;
  candidateName: string;
};

export type CommandAttempt = {
  executable: string;
  args: readonly string[];
  source: CommandSource;
  fileKind: CommandFileKind;
  candidateName: string;
  resolved: boolean;
};

export type CommandResolution = {
  agentId?: string;
  attempts: readonly CommandAttempt[];
  selected?: CommandAttempt;
  diagnostics: {
    explicitOverrideKey?: string;
    rejectedOverride?: 'empty' | 'contains-crlf' | 'contains-arguments' | 'ps1-without-interpreter';
    searchedConfiguredPaths: number;
    searchedProcessPath: boolean;
  };
};

export type CommandSpec = {
  id: string;
  candidates: readonly string[];
  fixedArgs: readonly string[];
  overrideEnvKey?: string;
};

export type LaunchOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: 'ignore' | 'pipe';
};
export type CommandProbeResult = {
  ok: boolean;
  missing: boolean;
  exitCode: number | null;
  output: string;
};

export function resolveCommand(spec: CommandSpec, options?: {
  env?: NodeJS.ProcessEnv;
  configuredSearchPaths?: readonly string[];
}): CommandResolution;
export function probeCommand(attempt: CommandAttempt, options?: LaunchOptions): Promise<CommandProbeResult>;
export function launchCommand(attempt: CommandAttempt, options: LaunchOptions): ChildProcess;
export function toAcpxRegistryOverride(resolution: CommandResolution): string[];
```

`CommandSpec` is registry-owned metadata and the only source of candidate names, fixed ACP arguments, fallback order, and override-variable keys. `CommandResolution` retains all candidates for diagnostics. ACPX consumers pass `toAcpxRegistryOverride()` output unmodified and call `ensureSession` with an agent ID, never a rendered command.

## Locked Resolution And Platform Semantics

- Public overrides are `ACEH_CODEAGENT_COMMAND`, `ACEH_NGA_COMMAND`, and `ACEH_CODEGENIE_COMMAND`. An explicit value replaces discovery and has no implicit fallback. Existing `ACE_NGA_SDK_*` / `ACE_CODEGENIE_SDK_*` remain SDK-only.
- An override is one executable reference. Trim whitespace and reject CR/LF. A value containing a path separator or resolving as an absolute path is an opaque path and may contain spaces or legal filesystem characters such as `&`, `%`, `!`, and parentheses; a bare command must match the safe command-name grammar. Remove one matching pair of outer double quotes for compatibility; reject embedded quotes, a bare name followed by whitespace/arguments, and shell operators in a bare command. Never parse a command line.
- Without an override: configured search paths, normalized process PATH, then metadata fallback candidates. Dedupe normalized executable identities while retaining order. Each executable remains one argv element.
- On Windows, read PATH case-insensitively and provide both `PATH` and `Path` to all children. Evaluate extensions in `PATHEXT` order, not hard-coded `.cmd` preference. Explicit extensions remain explicit.
- `.exe`/`.com` are native, `.cmd`/`.bat` are batch, and `.ps1` is rejected unless a later explicit interpreter-argv feature is designed. No implicit PowerShell.
- Generic launch uses `spawn(executable, args, { shell: false })` for native/POSIX files, plus one dedicated batch implementation for `.cmd/.bat`. It alone handles all cmd metacharacters (`&|<>()^%!`, quotes, trailing backslashes). ACPX receives `[executable, ...args]` and handles batch itself; ACEHarness must not pre-wrap ACPX with `cmd.exe` or quote twice.
- Working directory is process/runtime `cwd`; do not append a context-specific `--cwd` into registry overrides unless upstream ACP contract proves it required and metadata/test coverage records the exception.

## Consumer Migration Map

| Current consumer | Existing behavior | Replacement contract |
|---|---|---|
| `command-exists.ts` | String-or-null discovery; independent probe | `resolveCommand`; temporary compatibility wrapper only during migration. |
| `command-runner.ts` and `/api/cli/run` | Find string then Windows shell-spawn | Consume selected `CommandAttempt`; call `launchCommand`. |
| `/api/engine/availability` | CodeGenie-only override and local quoting | Resolve registry spec; append `--version` structurally; call `probeCommand`. |
| `acpx-adapter.ts` | Special searches and shell-string attempts | Registry spec and argv override; remove `wrapWindowsCmdShellParts`, `formatCommandParts`, and special path branches. |
| Runtime client/model route | May derive `agent` command string | Pass agent ID and use registry generated from the same resolution. |
| ACPX diagnostic scripts | Separate bare-name override map | Consume a buildable shared resolver entrypoint or canonical serialized output; no second resolver. |

## Legacy-To-Replacement Test Map

| Existing evidence | Replacement or preserved coverage |
|---|---|
| `runtime-adapters`: NGA/CodeGenie command mapping | Registry spec test for candidates, fixed args, `ngagent` -> `nga`, and `--disable-update`. |
| `runtime-adapters`: ACPX 0.13 major guard | Retain; add all three agent registry override tests asserting `string[]`, never shell string. |
| `runtime-adapters`: CodeGenie override cache invalidation | Resolver cache suite for all three keys, search path/PATH changes, and no unresolved bare-name caching. |
| `api-engine-availability`: CodeGenie configured command | Parameterized CodeAgent/NGA/CodeGenie fixture with space-containing paths and argv capture of `--version`. |
| `agent-registry`: availability primary/fallback assertions | Retain; assert `CommandSpec` feeds both probe and ACPX override. |
| Runtime client/model route mocks | Assert `agent: agentId` and a shared registry override, for model discovery and normal session startup. |
| No focused resolver/runner suite | Add explicit/configured/PATH/fallback/missing/outer quote/CR-LF/PATHEXT/PATH-Path/structured-argv tests. |
| No cmd metacharacter coverage | Windows-only real `.cmd`/`.bat` fixture under paths containing spaces, with `&`, `%`, `!`, quotes, and trailing backslashes in arguments. |

## Follow-Up Work

- Task 2 implements the locked API and compatibility wrappers until consumers migrate.
- Task 3 moves ACPX runtime/model discovery and all three overrides; it must validate any agent-specific `--cwd` requirement from upstream documentation.
- Task 4 migrates availability and scripts, exposes all three variables in the UI registry, and documents them in Chinese and English READMEs.
- Task 5 supplies the real fixtures and CI proof from the test map.

## Acceptance

- The API is compile-ready and preserves one structured representation through discovery, probing, launch, ACPX transmission, and diagnostics.
- Any display rendering is derived from argv and cannot be passed to process launch or ACPX.
- The test map retains every identified legacy scenario and adds real Windows proof for the reported defect.

## Verification Record

- 2026-08-11 read-only audit complete: inspected command discovery/runner, ACPX adapter/runtime client, availability/model routes, registry, diagnostic script, focused tests, and ACPX 0.13 distribution source.
- Evidence: ACPX rejects raw Windows command strings and owns batch handling for argv; ACEHarness currently has three independent Windows command-string constructors.
- Not run: runtime implementation and tests are intentionally out of scope for this investigation task.
