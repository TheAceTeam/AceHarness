# Current Verification Gaps

Updated: 2026-11-28

- The exact Canvas IR field names and schema version have not been implemented or validated; Task 01 must close this before consumers are built.
- The repository currently has separate lightweight and state-machine schema guards; the migration path for a multi-node lightweight canvas needs executable schema tests in Task 02.
- React Flow version compatibility with the pasted component's visual patterns has not been tested; Task 05 must adapt rather than import `@xyflow/react`.
- No Agent repository manifest has been parsed or installed by ACEHarness; Task 06 must provide a fixture repository and rollback evidence.
- The final interaction between canvas edits, autosave, run snapshots, and deleted run history is not yet verified; Task 07 must cover it.

## Must-Run Verification

- 使用 `npx vitest run <相关测试文件>` 验证画布、执行适配和市场接口。
- Task 08 验证流程型与参考型 Skill、缺失输入、审阅确认和来源变更。
- Task 09 验证节点尝试归属、重复事件、断线恢复、删除运行和历史回放。
- Existing workflow schema and state-machine tests.
- React Flow editor UI tests for add/connect/edit/delete/undo/redo and responsive layout.
- Agent market fixture tests for manifest validation, install, update diff, rollback, path traversal and script rejection.
- End-to-end legacy config → canvas → run snapshot checks.
