# Runtime-First Engine Helpers

`src/lib/engines` no longer contains executable agent wrappers.

ACEHarness runtime execution now flows through:

```text
Chat / Workflow / Probe
  -> RuntimeOrchestrator
  -> RuntimeAdapterRegistry
  -> AcpxAdapter or MagicAdapter
```

This directory only keeps small shared helpers that are not runtime adapters:

- `engine-config.ts`: shared `.agents` workspace path helpers.
- `engine-output.ts`: process/output text helpers used by projections.
- `opencode-command.ts`: command metadata helpers.
- `opencode-command-files.ts`: command file discovery fallback.

Do not add provider wrappers, SDK drivers, or `Engine` interface shims here.
Provider execution belongs in `src/lib/runtime-agent/adapters`.
