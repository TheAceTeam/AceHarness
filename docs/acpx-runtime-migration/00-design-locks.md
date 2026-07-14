# Design Locks

Updated: 2026-07-09

## Terms And Boundaries

- `Runtime` means the new ACEHarness-owned orchestration boundary, not acpx itself.
- `RuntimeAdapter` means the narrow integration contract implemented by `AcpxAdapter` and `MagicAdapter`.
- `Agent` means the user-facing engine/tool choice shown in `/engines`.
- `Model route` means the executable SQLite-backed mapping from model catalog entry to agent/runtime/provider config.
- `runtimeSessionId` means ACEHarness platform id. Provider/acpx ids are adapter-only binding data.

## Current Facts

- `package.json` already includes TanStack Start, Router, React Query, React DB, React Virtual, and TanStack AI.
- `package.json` still includes SDK packages such as `@openai/codex-sdk`, `@opencode-ai/sdk`, `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`, and ACP SDK packages.
- `src/lib/engines` contains old wrapper implementations and old `engine-interface`.
- `src/server/api-routes/engine` contains oldArchitecture engine API routes.
- `src/client/query/query-keys.ts` contains existing `engines`, `engineAvailability`, `models`, and `agents` query keys.
- `src/client/db/collections.ts` already uses TanStack DB local-only collections.

## Migration Or Implementation Principles

- New runtime code must not import old wrappers, old `Engine` interfaces, or old SDK-specific driver abstractions.
- SQLite is the server-side source of truth for sessions, turns, events, traces, model routes, probes, benchmarks, env profiles, secret profiles, and migration state.
- acpx is an adapter implementation, not the ACEHarness platform abstraction.
- `cangjie-magic` remains first-class through `MagicAdapter`.
- Permissions default to `unrestricted`, but every permission request and auto approval must be audited.
- Chat UI must not display acpx/internal binding state; diagnostics may expose redacted internal details.
- `/engines` remains the route and navigation label for user familiarity, but the domain model must not continue to be `Engine`.
- Skills/MCP UI stays in place; runtime adds snapshots, env refs, and resolved config underneath.
- TanStack Query/DB are client mirrors and cache layers only. They are not sources of truth.

## Do Not Add

- Do not add a new SDK driver layer.
- Do not add a second frontend state stack parallel to existing TanStack Query/DB.
- Do not expose provider/acpx native ids in ordinary DTOs, Query cache, TanStack DB rows, or Chat projection.
- Do not use emoji as agent icon fallback.
- Do not make acpx-specific UI the primary user experience.
- Do not preserve old `/api/engine` as a long-term compatibility API.

## Example Or Documentation Rules

- Docs and examples should use `agentId`, `runtimeSessionId`, `turnId`, `modelRouteId`, and `runtimeProfileId`.
- oldArchitecture names such as `driver`, `backendSessionId`, `activeEngine`, and `ModelOption` may appear only in migration notes or deletion checks.
- Verification records must mention commands actually run and whether they passed, failed, or were skipped.
