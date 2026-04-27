# SuperSupervisor 增量规范

## 新增需求

### 需求:OpenSpec 文档制品与运行时对象分层
系统 MUST 同时支持官方 OpenSpec 文档制品和项目内部运行时 `OpenSpecDocument`，且两者职责边界清晰。

#### 场景:spec-first 需求创建
- 假如用户明确要求按 OpenSpec 或 spec-first 方式推进
- 当系统开始创建 workflow 或规划后续实现时
- 则系统先产出官方 OpenSpec 风格的 proposal、design、tasks 和 spec
- 并且不得直接把内部运行时 `OpenSpecDocument` 当成官方 OpenSpec 成品返回

### 需求:workflow 创建与 OpenSpec 串联
在 spec-first 场景下，workflow 创建流程 MUST 基于已确认的 OpenSpec 文档制品继续推进。

#### 场景:基于已确认 spec 创建 workflow
- 假如当前需求已有 OpenSpec proposal、design、tasks 和 spec
- 当系统进入 workflow 配置建模阶段
- 则 workflow creator 基于已确认 spec 的目标、约束、阶段和分工设计 workflow
- 并且在生成 YAML 前继续执行原有校验流程

### 需求:SuperSupervisor 主链可持续维护
系统 SHOULD 使用 OpenSpec change 制品持续跟踪本次 SuperSupervisor 改造的已完成项、未完成项和实现顺序。

#### 场景:后续继续实现主链能力
- 假如开发者继续推进首页动态侧栏、创建态确认、运行态解释面或 Agent 体系
- 当实现发生变化时
- 则相应的 proposal、design、tasks 或增量规范需要同步更新
- 并且文档状态应和当前代码实现一致

## 新增需求

### 需求:运行态 spec 修改权限分层
系统 MUST 将运行态 spec 的修改权限分层为“步骤可改状态，Supervisor 可改其他内容”。

#### 场景:普通步骤回写运行结果
- 假如某个普通执行步骤完成或失败
- 当它向运行态 spec 回写信息时
- 则它只能更新状态类字段
- 并且不能直接修改目标、约束、阶段定义、分工和其他非状态内容

#### 场景:Supervisor 修订 spec
- 假如运行过程中需要修订非状态类 spec 内容
- 当系统接受该修订
- 则由 Supervisor 负责发起和确认
- 并且系统为该修订记录 revision

### 需求:run 级 spec 快照
系统 MUST 为每次 workflow run 创建独立的内部 spec 快照，而不是让多个 run 共用同一份运行态 spec。

#### 场景:新 run 启动
- 假如 workflow 已存在创建态基线 spec
- 当新的 run 启动时
- 则系统从基线 spec 派生一份 run 级快照
- 并且将后续运行态更新写入该 run 快照

### 需求:Supervisor 与 Agent 的 spec 提示词契约
系统 MUST 为 Supervisor 和普通运行 Agent 明确注入 spec 读取和修改边界。

#### 场景:Supervisor prompt 注入
- 假如系统为 Supervisor 构建运行态提示词
- 当该 prompt 被发送前
- 则其中包含当前 run 的 spec 快照、最近 revision 和可修改非状态内容的说明
- 并且明确它负责结构性修订

#### 场景:普通 Agent prompt 注入
- 假如系统为普通运行 Agent 构建步骤提示词
- 当该 prompt 被发送前
- 则其中包含与当前步骤相关的 spec 上下文和状态更新权限说明
- 并且明确它不能修改非状态内容

### 需求:状态更新与 revision 更新分流
系统 MUST 将普通状态回写和 Supervisor revision 记录区分处理。

#### 场景:普通步骤回写状态
- 假如某个步骤只是更新完成、阻塞或进行中的状态
- 当系统处理该回写时
- 则系统只更新状态字段
- 并且不写入结构性 revision

#### 场景:Supervisor 修订结构内容
- 假如 Supervisor 要调整目标、约束、阶段、分工或其他非状态信息
- 当系统接受这次调整时
- 则系统写入 revision 并更新对应内容
- 并且该更新与普通状态回写链路隔离

### 需求:Agent 推荐入口与工作流会话沉淀
系统 SHOULD 在 Agent 管理页提供推荐入口链路，并在首页会话栏沉淀 workflow 绑定的 Supervisor / Agent 会话目录。

#### 场景:从 Agent 管理页跳回首页协作
- 假如用户在 Agent 管理页选中了某个角色
- 当用户准备继续对话式规划或精修
- 则系统允许将该角色信息作为首页会话起点带回首页
- 并且保留推荐的入口链路，而不是只停留在配置编辑

#### 场景:查看工作流通讯录与历史沉淀
- 假如首页当前会话已绑定 workflow run，且 run 内存在 Supervisor 与多个 Agent 会话
- 当用户打开左侧会话栏
- 则系统展示当前 run 的通讯录和最近沉淀的 workflow 相关会话
- 并且这些会话保留 workflow / creation 绑定信息，便于后续继续进入上下文

### 需求:质量门禁、经验回流与记忆分层
系统 SHOULD 把 preCommands 的结构化质量结果、当前 run 结算结论和历史经验库共同作为平台能力沉淀。

#### 场景:preCommands 形成质量门禁
- 假如某个步骤配置了 build、lint、test 等 preCommands
- 当系统执行这些命令
- 则系统生成结构化的质量门禁记录
- 并且将其回写到运行状态与工作台展示中

#### 场景:运行时读取历史经验
- 假如当前 workflow 已存在历史经验沉淀
- 当后续 Agent 或 Supervisor 生成下一轮输出
- 则系统向其注入近期经验摘要
- 并且页面按 runtime、review、history 三层展示记忆来源
