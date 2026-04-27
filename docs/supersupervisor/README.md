# SuperSupervisor 体验拆分文档

基于 [`../角色化Agent与全局Supervisor改造设计.md`](/usr1/ace/cangjie_frontend_ace/docs/角色化Agent与全局Supervisor改造设计.md) 第 27 节重写，但不再按 `OpenSpec` 单点拆分，而是按整条用户体验拆分。

当前约束已经按最新要求收口：

1. `OpenSpec` 发生在 workflow 创建会话里，不代表 Supervisor 已经开始运行。
2. Supervisor 只在 workflow 启动后创建，且每次 run 都有独立 supervisor session。
3. 首页侧栏要同时理解“创建态会话”和“运行态会话”，不能只绑定一个固定 supervisor。
4. 文档重点是整体体验、代码现状、未完成项和改进方向，`OpenSpec` 只是其中一个承载点。
5. 首页动态侧边栏已经开始按对话意图触发，不再默认整块常驻。

建议阅读顺序：

1. [01-整体体验总览.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/01-整体体验总览.md)
2. [02-创建体验与OpenSpec承载.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/02-创建体验与OpenSpec承载.md)
3. [03-首页侧栏与会话联动.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/03-首页侧栏与会话联动.md)
4. [04-Workflow运行与Supervisor.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/04-Workflow运行与Supervisor.md)
5. [05-Agent体系与创建体验.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/05-Agent体系与创建体验.md)
6. [06-平台能力与待办总表.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/06-平台能力与待办总表.md)

如果只看排期和缺口，直接看第 6 篇。

## 总纲 27 节覆盖矩阵

以下按 [`../角色化Agent与全局Supervisor改造设计.md`](/usr1/ace/cangjie_frontend_ace/docs/角色化Agent与全局Supervisor改造设计.md) 第 27 节逐项对照：

1. `27.1 OpenSpec 主链`
   - 主落点：[02-创建体验与OpenSpec承载.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/02-创建体验与OpenSpec承载.md)
   - 关联补充：[04-Workflow运行与Supervisor.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/04-Workflow运行与Supervisor.md)
   - 当前状态：已覆盖，且已写明已完成 / 未完成 / 改进项

2. `27.2 创建页与首页侧栏`
   - 主落点：[03-首页侧栏与会话联动.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/03-首页侧栏与会话联动.md)
   - 关联补充：[02-创建体验与OpenSpec承载.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/02-创建体验与OpenSpec承载.md)
   - 当前状态：已覆盖，包含侧栏收口、自动关联、动态唤起、card/action 治理

3. `27.3 Workflow 运行页`
   - 主落点：[04-Workflow运行与Supervisor.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/04-Workflow运行与Supervisor.md)
   - 当前状态：已覆盖，包含进度区、Agent 通讯录、聊天分层、右侧承接交互

4. `27.4 Agent 与创建体验`
   - 主落点：[05-Agent体系与创建体验.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/05-Agent体系与创建体验.md)
   - 关联补充：[02-创建体验与OpenSpec承载.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/02-创建体验与OpenSpec承载.md)
   - 当前状态：已覆盖，包含统一创建体验、分工推荐、正式头像待办

5. `27.5 运行时能力`
   - 主落点：[04-Workflow运行与Supervisor.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/04-Workflow运行与Supervisor.md)
   - 汇总落点：[06-平台能力与待办总表.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/06-平台能力与待办总表.md)
   - 当前状态：已覆盖，包含 checkpoint 刷新设计、经验召回、关系系统、演练模式

6. `27.6 明确未完成项清单`
   - 主落点：[06-平台能力与待办总表.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/06-平台能力与待办总表.md)
   - 当前状态：已覆盖，且已补完成度、优先级和实施顺序

## 完成状态查看指引

如果要快速判断“做到了多少”，按下面看：

1. 看 [01-整体体验总览.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/01-整体体验总览.md) 的“完成度判断”
2. 看各专题文档里的：
   - `已完成`
   - `未完成`
   - `代码仓判断`
   - `改进项`
3. 看 [06-平台能力与待办总表.md](/usr1/ace/cangjie_frontend_ace/docs/supersupervisor/06-平台能力与待办总表.md) 的：
   - `核心未完成项`
   - `建议实施顺序`
   - `每块完成度`

## 当前结论

就总纲第 27 节而言，这组拆分稿现在已经做到：

1. 每个条目都有对应落点
2. 每个主题都有完成状态表达
3. 每个主题都有后续改进方向
4. 文档中的创建态 `OpenSpec`、首页动态侧栏、workflow Agent 上下文对话等状态已和当前代码实现重新对齐

尚未做的是把总纲第 1 到 26 节也全部按同样方式拆出专题文档。
