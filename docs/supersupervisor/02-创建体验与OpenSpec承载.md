# 02 创建体验与 OpenSpec 承载

对应总纲：27.1、27.2、27.4 的创建部分

## 目标

创建 workflow 的体验应当从“填配置 + AI 生成 YAML”升级为：

1. 收集需求
2. 澄清目标、约束、边界
3. 形成 `OpenSpec`
4. 用户确认或修订
5. 再从 `OpenSpec` 派生 workflow 草案

这里的重点不是强调 `OpenSpec` 本身，而是让创建阶段有一个稳定、可确认、可回看的中间态。

## 当前代码现状

已完成：

1. `NewConfigModal` 已有完整的 AI 引导式创建壳，而不是纯静态表单，见 [src/components/NewConfigModal.tsx](/usr1/ace/cangjie_frontend_ace/src/components/NewConfigModal.tsx)。
2. 创建接口已经存在，见 [src/app/api/configs/create/route.ts](/usr1/ace/cangjie_frontend_ace/src/app/api/configs/create/route.ts) 和 [src/app/api/configs/ai-generate/route.ts](/usr1/ace/cangjie_frontend_ace/src/app/api/configs/ai-generate/route.ts)。
3. schema 已经能承载创建表单和 workflow config 基础结构，见 [src/lib/schemas.ts](/usr1/ace/cangjie_frontend_ace/src/lib/schemas.ts)。
4. 创建期 session、`OpenSpecDocument`、revision、progress 已落成真实数据结构，见 [src/lib/schemas.ts](/usr1/ace/cangjie_frontend_ace/src/lib/schemas.ts) 与 [src/lib/openspec-store.ts](/usr1/ace/cangjie_frontend_ace/src/lib/openspec-store.ts)。
5. 创建 workflow 后已经会回写 creation session 到首页聊天会话，见 [src/components/NewConfigModal.tsx](/usr1/ace/cangjie_frontend_ace/src/components/NewConfigModal.tsx) 与 [src/lib/chat-persistence.ts](/usr1/ace/cangjie_frontend_ace/src/lib/chat-persistence.ts)。
6. workflow status API 已能把关联 creation session / `OpenSpec` 摘要与明细回传给运行页，见 [src/app/api/workflow/status/route.ts](/usr1/ace/cangjie_frontend_ace/src/app/api/workflow/status/route.ts)。

未完成：

1. 创建流程虽然已有独立 `OpenSpec` 文档，但 UI 仍然更像“requirements 直接生成 config”，`OpenSpec` 确认步骤还不够显式。
2. 创建期 session 已存在，但需求澄清过程本身的细粒度历史还没有作为稳定交互面展示出来。
3. “确认 `OpenSpec` 后再进入 workflow 草案”的显式阶段切换仍未完整体现在创建 UI 上。
4. Agent 分工推荐仍然没有建立在创建期统一设计对象之上。

## 代码仓判断

当前创建体验属于“状态承载体已落地，但交互主链未完全显化”。

证据：

1. `NewConfigModal` 有 AI 引导式交互，也已经能把创建结果沉淀为 creation session 和 `OpenSpec`。
2. 独立 `OpenSpec` store / revision / creation-session 持久化已经存在。
3. 文档想要的“设计先于运行”已经落到数据结构层，但还没有完全落到显式交互层。

## 已完成部分

1. 创建 UI 不是空白。
2. AI 引导创建不是一次性按钮，而是连续对话流程。
3. workflow 草案生成链路已经可用，后续可承接更前置的设计步骤。
4. 创建态已经有稳定状态源，而不再只是临时表单值。
5. run 启动后能够继承创建态 `OpenSpec`，并支持后续修订记录。

## 未完成部分

1. `OpenSpec` 确认/修订 UI
2. 从 `OpenSpec` 派生 workflow 草案的显式阶段化呈现
3. Agent 分工推荐建立在 `OpenSpec` 之上的链路
4. 创建态历史与修订视图的进一步产品化

## 改进项

1. 新增 `creationSession` 概念，和 chat session 绑定，但不等于 run session。
2. 新增 `OpenSpecDocument`、revision、status、confirmedAt 等创建态结构。
3. `NewConfigModal` 改成三个显式阶段：
   - 需求与约束
   - `OpenSpec` 预览与确认
   - workflow 草案预览与生成
4. Agent 分工推荐放到 `OpenSpec` 确认后，而不是直接从 requirements 粗暴派生。
5. 创建完成后把结果回写首页当前会话，供侧栏和后续启动复用。

## 优先级判断

这是后续联动的第一优先级之一。

原因：

1. 没有创建态承载体，首页侧栏很难区分“正在设计”和“已经在运行”。
2. 没有创建态状态源，run 启动时也无法稳定继承设计结果。
3. 后面的 Supervisor 跟踪、页面进度、经验回流都会继续缺统一上游输入。
