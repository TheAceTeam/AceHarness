# Dependency And Execution Plan

## Dependency Edges

- Task 01 -> Task 02
- Task 01 -> Task 06
- Task 02 -> Task 03
- Task 02 -> Task 04
- Task 02 -> Task 05
- Tasks 02, 05 -> Task 08
- Tasks 03, 05 -> Task 09
- Tasks 03, 04, 05, 06, 08, 09 -> Task 07

## Execution Waves

| Wave | Tasks | Prerequisite | Execution Rule | Release Gate |
|------|-------|--------------|----------------|--------------|
| 1 | Task 01 | None | Serial | Coordinator reviews Canvas IR, ID, migration and validation contract. |
| 2 | Task 02, Task 06 | Task 01 | Run concurrently; compiler and marketplace own separate modules | Coordinator reviews compiler boundary and Agent market contract/API evidence. |
| 3 | Task 03, Task 04, Task 05 | Task 02 | Run concurrently with separate runtime, adapter, and UI ownership | Coordinator reviews all three surfaces and confirms no shared mutable contract drift. |
| 4 | Tasks 08, 09 | Task 08 waits for 02 and 05. Task 09 waits for 03 and 05. | 转换草案与运行投影独立开发，共用已审阅的画布契约 | 分别审阅草案校验和运行重放证据 |
| 5 | Task 07 | Tasks 03, 04, 05, 06, 08, 09 | 串行接线与端到端验证 | 通过迁移、转换、看板、市场和旧流程回归验证 |

## Scheduling Notes

- Task 01 is a hard serial gate because UI, runtime, state-machine mapping, and marketplace provenance all depend on stable IDs and version rules.
- Task 02 is separate from Task 06 so repository-market work can proceed without changing workflow execution files.
- Wave 3 is safe only when Task 02 freezes the adapter boundary. Runtime, state mapping, and UI must not independently redefine the Canvas IR.
- Task 07 owns cross-feature fixtures and final verification; earlier tasks may add focused tests but may not mark the overall work complete.
- Task 08 和 09 可以各自在依赖就绪后启动。共享路由、工作台接线和跨功能测试由 Task 07 统一修改。
- This plan is documentation-only at present. No child-agent execution has been started.
