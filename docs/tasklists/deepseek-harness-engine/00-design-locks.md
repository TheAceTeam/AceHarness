# Design Locks

Updated: 2026-08-30

## Terms And Boundaries

- `deepseek-harness` is the built-in ACEHarness engine ID and always uses the `acpx` runtime.
- `@openma/deepseek-harness-acp` is the ACP server and DSH bundle used by ACEHarness. Its `dsh-acp` entry is the only DeepSeek ACP process launched by ACPX.
- DSH user state is addressed through `DSH_HOME`; credentials, settings, presets, plugins, and session persistence remain owned by DSH.
- ACEHarness passes provider/model and permission settings through the package's documented `DSH_*` environment variables and does not synthesize a second DSH profile.

## Current Facts

- `@openma/deepseek-harness-acp@0.4.26` publishes a complete ACP bridge, DSH bundle patch, standalone profile root, and a locked `vendor/dsh-runtime.tgz`.
- The package documents live text/reasoning/tool updates, session load/list/resume, model catalog/configuration, MCP, permissions, plans, slash commands, and shared `$DSH_HOME` state.
- A local process probe returned ACP `initialize`, `session/new`, `session/list`, and `session/load` responses with no provider call.
- The package supports both a DSH profile plugin (`dsh --profile acp`) and a standalone `dsh-acp` binary; ACEHarness uses the standalone binary through ACPX.

## Migration Or Implementation Principles

- All requests go through ACPX and the OpenMA ACP process. ACEHarness does not implement a provider-direct adapter or a second ACP protocol implementation.
- The ACEHarness package declares `@openma/deepseek-harness-acp` as an install-time dependency; no runtime package manager or profile provisioning command is allowed.
- The launcher resolves the package-local `dsh-acp` entry and forwards `DSH_HOME`, `DSH_PROVIDER`, `DSH_MODEL`, `DSH_PERMISSION_MODE`, `DEEPSEEK_API_KEY`, and `DEEPSEEK_BASE_URL` without logging secrets.
- Existing DSH settings, credentials, presets, plugins, and sessions are reused by pointing the ACP process at the user's DSH home; ACEHarness must not copy or recreate that state.

## Do Not Add

- Do not add a second ACP transport or provider-direct DeepSeek adapter beside `@openma/deepseek-harness-acp`.
- Do not maintain a separate ACEHarness-owned DeepSeek DSH profile or bundle patch.
- Do not install packages, run `dsh plugin add`, mutate user plugin state, or create/delete historical profiles at runtime.

## Example Or Documentation Rules

- Use `DEEPSEEK_API_KEY="sk-your-api-key"`, `DEEPSEEK_BASE_URL="https://api.deepseek.com"`, and `DSH_PERMISSION_MODE="workspace-write"` in examples.
- Record the OpenMA package version, shared DSH_HOME behavior, no-runtime-install guarantee, and every ACPX protocol verification in the tasklist logs.
