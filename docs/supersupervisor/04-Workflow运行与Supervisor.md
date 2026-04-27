# 04 Workflow 运行与 Supervisor

对应总纲：27.3、27.5 的主体

## 目标

workflow 启动后，系统才进入运行态。

这时应该有三件事同时成立：

1. 为本次 run 创建独立 supervisor session
2. 所有 Agent 感知已确认的设计输入
3. workflow 页面和首页侧栏都能看到同一份运行事实

## 当前代码现状

已完成：

1. 状态机运行时已经比较成熟，核心在 [src/lib/state-machine-workflow-manager.ts](/usr1/ace/cangjie_frontend_ace/src/lib/state-machine-workflow-manager.ts)。
2. 默认 Supervisor 已经有真实挂载逻辑，见 [src/lib/default-supervisor.ts](/usr1/ace/cangjie_frontend_ace/src/lib/default-supervisor.ts)。
3. run 状态持久化中已经有 `supervisorAgent`、`supervisorSessionId`、`attachedAgentSessions`、`latestSupervisorReview` 等字段，见 [src/lib/run-state-persistence.ts](/usr1/ace/cangjie_frontend_ace/src/lib/run-state-persistence.ts)。
4. workflow 页面已经能展示运行过程、人工检查点、plan review、stream、Agent 面板等，见 [src/app/workbench/[config]/page.tsx](/usr1/ace/cangjie_frontend_ace/src/app/workbench/[config]/page.tsx)。
5. 最终 review 与经验沉淀已有实现，见 [src/lib/workflow-experience-store.ts](/usr1/ace/cangjie_frontend_ace/src/lib/workflow-experience-store.ts)。
6. workflow 页面已经有 Agent 相关展示容器，可继续往“通讯录”和持续对话方向演进。
7. workflow status API 已能返回 creation session、`OpenSpec` 摘要 / 详情 / revisions 以及 final review，见 [src/app/api/workflow/status/route.ts](/usr1/ace/cangjie_frontend_ace/src/app/api/workflow/status/route.ts)。
8. state-machine runtime 已支持由 Supervisor 追加 `OpenSpec` 修订记录，见 [src/lib/state-machine-workflow-manager.ts](/usr1/ace/cangjie_frontend_ace/src/lib/state-machine-workflow-manager.ts) 与 [src/lib/openspec-store.ts](/usr1/ace/cangjie_frontend_ace/src/lib/openspec-store.ts)。
9. workflow 页面已经能展示创建态摘要、`OpenSpec` 进度、最近修订和 final review，见 [src/app/workbench/[config]/page.tsx](/usr1/ace/cangjie_frontend_ace/src/app/workbench/[config]/page.tsx)。
10. workflow 页内 Agent 对话已是真实链路，且默认始终携带 workflow 上下文，不再区分 standalone 模式，见 [src/components/AgentPanel.tsx](/usr1/ace/cangjie_frontend_ace/src/components/AgentPanel.tsx)。

未完成：

1. workflow 页面已经有设计态信息，但“设计输入 -> 阶段推进 -> 偏差原因”的映射仍然偏弱。
2. checkpoint 中还不能直接查看当前设计承载体，也不能直接刷新它。
3. run 级 Supervisor 虽然存在，但页面上的统一指挥视角仍可继续强化。
4. 运行结果、阶段事实、设计偏差之间还没有足够直观的对照层。
5. Workflow 页面“Agent 通讯录”语义还未完全成立。
6. 右侧侧栏在运行页中的展开 / 收起 / 拖拽和详情抽屉承接还未补全。

## 代码仓判断

运行态仍然是当前实现里最扎实的一块。

但它扎实的部分主要是：

1. workflow 执行
2. Supervisor runtime
3. 状态持久化
4. review 和经验
5. `OpenSpec` 修订落盘
6. Agent 工作流上下文对话

还不够扎实的部分主要是：

1. 设计输入与执行事实的映射可视化
2. run 级设计偏差跟踪
3. 创建态与运行态的连续叙事

## 已完成部分

1. run 级 supervisor session 的运行时骨架
2. workflow 页面主执行体验
3. checkpoint / 审批 / review 基础链路
4. 经验落盘与 final review
5. Agent 展示和 run 级状态展示的容器基础
6. `OpenSpec` 摘要、修订和 final review 展示
7. Agent 上下文对话主链

## 未完成部分

1. 设计输入到执行进展的更强映射
2. Supervisor 驱动的设计刷新入口在运行页的更明确承接
3. 首页侧栏与 workbench 的统一 run 视图继续收口
4. Agent 通讯录与持续聊天模型
5. 运行页右侧细节交互和详情抽屉承接

## 改进项

1. 在 status API 中返回 run 绑定的设计对象摘要和阶段进度。
2. 在 workbench 页增加单独的“设计与执行”面板，而不是把信息继续塞进日志。
3. 在 checkpoint 弹层中加入：
   - 当前设计摘要
   - 偏差提示
   - 请求 Supervisor 刷新设计
4. 在 final review 中补“初始设计 vs 最终执行”差异摘要。
5. 让首页侧栏和 workbench 共用 run 级 supervisor 视图模型，避免两套口径。
6. workflow 页面继续坚持 workflow-context chat 单一路径，不再额外扩展 standalone chat 分支。
7. 把 Agent 面板继续收口为“通讯录 + 会话入口”，而不只是配置或展示组件。
8. 右侧详情承接尽量用抽屉 / 面板，不继续把信息打散成更多卡片。

## 优先级判断

这块不需要推倒重来，主要是补一层“运行态解释面”。

它应该放在创建态 store 落地之后、首页联动完善之前或并行推进。
