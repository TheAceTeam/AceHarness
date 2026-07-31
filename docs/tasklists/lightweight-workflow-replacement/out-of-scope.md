# Out Of Scope

- Migration, conversion, or continued execution of existing phase-based workflow configurations.
- Removing the retained user-facing AI workflow-creation entry. The old phase executor and old creation plugin are out of scope for reuse, but QuickActions, `starterAction`, and ordinary homepage conversation must remain and route to lightweight creation under Task 11.
- Automatic deletion of old `.ace-outputs` directories in user project workspaces.
- Moving the global persisted run root from `<runtimeRoot>/runs/<runId>` to another storage layout. That is a separate storage-layout decision.
- A new ACEHarness-wide child-agent scheduler or engine capability implementation.
- Changes to unrelated Agora collaboration features, ordinary agent chat, or non-workflow plugins.
- Product-source changes outside the task ownership boundaries. Verification commands remain governed by the execution order; this documentation-only sync does not claim build, test, lint, TypeScript, or browser results.
