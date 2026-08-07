# 状态级对抗审查设计与执行方案

## 1. 目标

将现有任务级、固定档位式的审查强度，调整为以“工作流状态”为最小决策颗粒度：AI 在创建工作流时为每个符合条件的状态判断采用标准模式还是对抗模式，用户可以逐状态覆盖、锁定或交还 AI 判断。

在状态级判断之上增加一层明确的“全局意愿”：新建工作流时，该意愿约束最终保存的工作流配置；复用已有工作流时，该意愿只约束本次运行的有效配置快照。本文中的“复用”专指进入一个已经存在的工作流，点击“启动工作流”，为本次运行补充任务、工作目录及全局/状态上下文后创建新的 run；它不创建工作流副本，也不修改原 YAML。

本方案同时适配最新版 `dev` 的两种最终工作流产品：`lightweight` 是任务清单驱动、固定 1 个初始/终止状态和 1 个 Agent 步骤的受约束配置；`state-machine` 才使用显式多状态、步骤和转移。`ai-guided` 只是创建旅程，不是持久化工作流类型。状态总数的“最小充分”原则只适用于最终选择 `state-machine` 的草案；轻量工作流不得为了接入状态级对抗而突破其固定拓扑。

## 2. 已确认的产品决策

1. 审查模式以状态为最小颗粒度，不继续使用任务级 L1/L2/L3 作为主要控制方式。
2. 模式分为 `standard` 和 `adversarial` 两种。
3. 用户选择“按需开启”时，AI 在首次创建中给出状态模式、判断理由和初始编排，用户可以覆盖；“不开启对抗”时 AI 没有模式决定权。
4. 用户手动覆盖后锁定该状态；AI 后续不得改变，直到用户选择“交还 AI 判断”。
5. AI 根据状态的真实交付物、影响范围、不确定性和失败代价判断，不根据状态名称套固定规则。
6. 判断不确定时，AI 默认选择对抗模式。
7. 只有非终止状态允许配置模式；第一版不从 `type: human-checkpoint`、`requireHumanApproval` 或“所有步骤都没绑 Agent”推断纯人工等待状态。
8. 对抗状态中 defender、attacker、judge 必须使用不同的运行实例与隔离上下文；可以复用同一 Agent 配置和底层模型。
9. defender 阶段允许包含多个步骤，并可在同一状态内并行；attacker 在 defender 产出完成后执行；judge 最后执行。
10. 关闭对抗模式后，标准模式默认不保留独立 judge；由最后一个串行执行/验证步骤内联输出 verdict。仅明确由 review-policy 生成且未被修改的对抗专用步骤可自动删除，其余必须进入 diff 由用户决定。
11. 持久化 Agent 配置少于三个不构成阻塞；系统可从既有 Agent 派生三个隔离的角色实例。只有没有任何可执行的普通 Agent，或运行时无法建立隔离实例时才阻塞。
12. 列表页只显示模式徽标；状态详情页提供开关、AI 判断理由、角色编排和变更预览。
13. Supervisor 与状态对抗模式解耦，只负责调度、审阅和检查点建议，不充当 defender、attacker 或 judge。
14. AI 可以重新评估单个状态，也可以批量重新评估所有未锁定状态。
15. 手工新增的状态默认使用标准模式。
16. 旧工作流没有显式字段时，如果能识别出有序的 defender → attacker → judge 结构，则迁移时推断为对抗模式；其余推断为标准模式。首次保存后写入显式字段。
17. 最新版只持久化 `lightweight` 与 `state-machine` 两种最终工作流产品；`ai-guided` 是 UI/会话层创建旅程，确认后必须落为其中一种，不能写入工作流 YAML。
18. 创建旅程、最终工作流类型、可选规划深度和全局意愿是四个正交维度：`direct | ai-guided`、`lightweight | state-machine`、`compact | detailed`、`disabled | on-demand`。不得再用 `lightweight/full` 同时表示 AI 预算和产品类型。
19. 新版 `lightweight` 不直接承载状态级 defender → attacker → judge。AI 引导或直接轻量创建在 `on-demand` 下发现必须对抗时，必须先转换或重新规划为 `state-machine`；不得静默降级为 standard，也不得保留 `profile: lightweight` 后塞入多步骤对抗结构。
20. 终态可保留“汇总结果”步骤，但该步骤不标记为 judge、不要求 verdict，也不参与旧对抗结构识别。
21. AI 引导创建的产品类型建议、整体风险初判和状态机大纲在同一次规划调用返回，不增加固定的“类型/模式判断专用调用”。只有最终类型为 `state-machine` 时才进入逐状态步骤调用；模型返回“lightweight 但需要 adversarial”等矛盾结果时，只局部修复当前规划结果。
22. 批量重评估使用按状态 ID 定位的窄补丁，不使用完整 workflow 替换；`locked=true` 由应用层代码强制保护，不依赖提示词。
23. 第一版的“证据包”是由现有步骤输出组装的运行时证据上下文，不引入独立的持久化实体、run document 或查看器。
24. 状态稳定 ID 只用于补丁定位和锁定保护。第一版不支持状态重命名，转移继续以状态名引用目标状态。
25. 关闭对抗模式时不改写用户创建或修改过的步骤。如果变换后没有步骤输出 verdict，生成新的 review-policy 托管收口步骤，而不是修改用户内容。
26. `confidence=low` 必须搭配 `adversarial`。规范化层直接强制该约束，不作为校验失败，也不触发整体重新生成。
27. 运行时角色隔离和终态 verdict 豁免是创建链路改造的前置条件，必须先于 AI 创建链路和设计页交互落地。
28. 对抗状态使用独立的自循环上限，默认 `maxSelfTransitions: 2`；标准状态维持默认 3。
29. 对抗状态的重试轮使用降级编排：只执行 defender 修复和 judge 复核，不重复执行 attacker；上一轮 attacker 的发现通过证据上下文传入。
30. 对抗状态触发熔断时不强制转向下游状态，进入人工审批由用户决定放行、回退或终止；标准状态维持现有强制转移行为。
31. 新建工作流在任何 AI 规划或风险评估前必须询问全局意愿，只提供“不开启对抗”和“按需开启”两个产品选项；前者是硬约束，后者授权 AI 先判断最终产品类型，再在普通状态机内按状态判断。
32. 新建时选择“不开启对抗”，lightweight 必须保持固定无对抗结构，普通 state-machine 的所有非终态必须以 `standard` 保存；该保证由本地规范化/装配层强制执行，不能只依赖提示词。
33. “复用已有工作流”不是选择模板后创建可编辑副本，而是复用原配置启动一个新 run。全局意愿、AI 建议和用户逐状态覆盖均属于本次运行，不回写原工作流 YAML。
34. 复用时每次启动都必须显式选择全局意愿，默认不把该选择写入 `start-context-store`。任务说明、工作目录、全局上下文和状态上下文仍沿用现有启动上下文能力。
35. 复用时选择“不开启对抗”不调用 AI；lightweight 保持原固定结构，普通 state-machine 在本次运行快照中确定性地把所有非终态协调为 `standard`。选择“按需开启”时执行一次运行级规划：普通状态机返回状态级模式窄补丁，lightweight 返回整体是否需要对抗的窄建议；本地 reconciler 或轻量派生器负责生成有效快照。
36. “按需开启”的运行确认页允许用户逐状态覆盖 AI 建议；本次运行内的用户覆盖记为 `source=user, locked=true`，后续 AI 只能重新评估未锁定状态。“交还 AI 判断”只解除所选状态的运行级锁并重新生成 diff。
37. 每个 run 必须持久化自己的 `RunReviewPlan` 和有效配置快照。恢复、重试和人工跳转继续读取同一快照，不受启动后原配置变化影响。
38. 全局意愿覆盖根工作流及其可达的全部子工作流。状态身份使用 `{configFile, stateId}`，避免不同配置中的同名或同 ID 状态互相覆盖。
39. 启动前检查必须针对最终有效快照重新执行；不能用用户选择全局意愿之前的原配置预检结果作为启动依据。
40. “按需开启”评估失败时不得静默降级为 `standard`。用户可以重试评估，或在确认页手工完成全部状态选择；低置信度仍按保守规则选择 `adversarial`。
41. 旧 API 调用方如果没有提交全局意愿，后端暂时保持原配置语义作为兼容路径并记录弃用信息；新 UI 不展示第三个“继承配置”选项，必须在两个产品选项中显式选择。
42. 直接创建 `lightweight`、直接创建 `state-machine` 和 `ai-guided` 三个 UI 入口都必须选择全局意愿；`on-demand` 授权 AI 评估，`disabled` 不授权 AI 决定或生成对抗结构。
43. 直接或 AI 引导创建的轻量草案若被用户改为“需要对抗”，必须进入状态机重新规划并再次确认；轻量草案不显示虚假的逐状态开关。
44. 复用轻量工作流时，`disabled` 直接运行原轻量快照；`on-demand` 判断无需对抗时仍运行轻量快照，判断需要对抗时只为本次 run 派生普通状态机有效快照，至少包含“执行与对抗 → 完成”，不修改原 YAML、不创建可复用副本。
45. 设计页“交还 AI 判断”不得先改写当前草稿。它只在候选目标中携带显式解锁意图；AI 失败、用户关闭弹窗或丢弃 diff 时原锁保持不变，只有用户确认应用 diff 时才把解锁与新策略原子写入当前草稿。
46. 最终 preflight 必须扫描本次有效依赖图中的根配置和全部子工作流，并按各配置的有效 `projectRoot` 执行；命令结果记录 `configFile/cwd`。已计划 run 的快照缺失或损坏时失败关闭，禁止从此刻的原 YAML 重建。
47. `on-demand` 批量评估失败或返回无效/缺失建议时，服务器仍返回可编辑的阻塞方案，所有未锁定目标标记“等待人工选择”；只有用户显式选完后才解除阻塞，不能把缺失建议解释成 standard。
48. 恢复不含 `creationAdversarialIntent` 的旧创建会话时保持“尚未选择”，不得默认为 `on-demand`；用户必须显式作出全局意愿选择后才能继续创建或调用 AI。

## 3. 状态拆分原则

### 3.1 按最终产品类型区分结构

| 最终产品 | 结构约束 | 对抗语义 |
|---|---|---|
| `lightweight` | 固定 1 个同时为 initial/final 的状态、1 个 Agent 步骤、0 个转移；必须使用内部锁定的 `aceharness-tasklist` | 不写状态级 `reviewPolicy`；若实际需要对抗，先转换为 `state-machine` |
| `state-machine` | 最小充分；硬下限为 1 个可执行状态和 1 个终态，共 2 个状态 | 每个非终态按全局意愿协调为 standard 或 adversarial，终态不参与 |

状态机不得为了满足推荐数量制造没有独立流程意义的状态。状态数上限属于产品保护阈值，不作为 AI 拆分目标。规划深度可以影响收集上下文和 Spec 追踪程度，但不能另行规定安全阈值。

### 3.2 “最小充分”判断

当最终产品为 `state-machine` 时，AI 先建立 1 个可执行状态和 1 个完成状态，再根据独立流程边界决定是否拆分。只有满足下列至少一项时，才把一段工作提升为独立状态：

- 形成可以独立验收的交付物；
- 需要独立的 `pass / conditional_pass / fail` 裁决；
- 失败后需要回退到特定上游状态；
- 需要单独的人工审批；
- 需要单独展示进度或暂停恢复；
- 需要切换 Agent 编队或执行权限；
- 用户需要能够单独重跑这一阶段。

如果只是同一业务目标下的连续动作、并行工作或角色协作，应表达为同一状态内的多个步骤，而不是拆成多个状态。

### 3.3 两状态示例

```text
执行（standard）
├─ 产出/修改
└─ 最后一个串行步骤内联输出 verdict
        或
执行（adversarial）
└─ defender → attacker → judge 输出 verdict
        │
        ├─ pass ─────────────→ 完成
        └─ conditional/fail ─→ 执行
```

两状态只代表状态机有一个业务流转边界，不限制状态内部的步骤数，也不影响该状态开启对抗模式；它不是新版轻量工作流的结构。

### 3.4 AI 产品类型与状态大纲提示词分层

AI 引导创建先共享以下产品类型门禁：

> 根据用户目标、是否需要显式状态边界、条件转移、回退、并行步骤、子工作流、Supervisor 和对抗审查，推荐最终工作流类型。只有目标清晰、可以由一个执行 Agent 通过任务清单动态拆分和验收，并且不需要状态级对抗时，才推荐 lightweight。只要需要多状态编排或任一环节需要 defender → attacker → judge，就推荐 state-machine。不要为了保持 lightweight 而降低风险判断，也不要给 lightweight 生成多状态或多步骤结构。

最终推荐 `lightweight` 时，AI 只提供单任务目标、执行 Agent 建议、类型理由和整体风险判断；固定状态、固定步骤和 `aceharness-tasklist` 由本地装配器生成。

最终推荐 `state-machine` 时，再追加状态大纲规则：

> 根据用户目标生成最小充分的状态集合，状态数量包含终态。至少包含 1 个可执行状态和 1 个终态。只有当某阶段具有独立交付物，并需要独立验收、回退、人工审批、进度展示、编队切换或单独重跑时，才拆分为独立状态；否则将相关工作组织为同一状态内的步骤。不要为了凑数量创建状态。

`compact | detailed` 只控制上下文收集、Spec 追踪和解释深度，不作为最终工作流产品类型，也不得维护不同的对抗安全阈值。

## 4. 配置模型

建议在状态上增加稳定 ID 和审查策略：

```yaml
id: state-architecture-design
reviewPolicy:
  mode: adversarial       # standard | adversarial
  source: ai              # ai | user | legacy | default
  locked: false
  confidence: high        # high | medium | low
  riskSignals:
    - 跨模块接口
    - 不可逆数据变更
  rationale: >-
    涉及认证边界、跨模块接口和不可逆数据变更，需要独立攻击审查。
```

字段语义：

| 字段 | 说明 |
|---|---|
| `mode` | 当前状态采用标准模式还是对抗模式 |
| `source` | 当前判断来自 AI、用户、旧配置迁移或系统默认值 |
| `locked` | 是否禁止 AI 后续自动修改 |
| `confidence` | AI 对当前模式判断的把握程度；`low` 必须搭配 `adversarial`，由规范化层强制 |
| `riskSignals` | 触发当前判断的具体风险信号 |
| `rationale` | AI 或用户选择该模式的可读理由 |

保存时应保证 `source=user` 的状态默认 `locked=true`；“交还 AI 判断”将 `source` 改回 `ai`、`locked=false`，并触发该状态重新评估。

`id` 是补丁定位和锁定保护的稳定键，schema 中为兼容旧配置保持 optional。其生命周期固定为：

1. AI 新建、手工新增和草案规范化的状态当场生成 UUID，不等到运行或补丁应用时生成；
2. 旧配置在 GET/只读校验时不生成随机 ID，避免每次读取漂移；
3. 旧配置首次保存时为缺失 ID 的状态生成并物化 UUID；
4. 状态 ID 在同一 workflow 内必须非空且唯一，新配置冲突视为校验错误；
5. 补丁优先精确匹配 `stateId`；仅当目标状态本身没有 ID 时才允许使用独立 `stateName` 字段回落，不使用数组 index 作为应用身份。

第一版不支持状态重命名。原因是转移规则仍以状态名引用目标（`transitions[].to`），运行时的当前状态、断点恢复也按状态名定位；引入重命名需要同时级联更新转移引用并处理运行中配置，超出本方案范围。设计页的状态名编辑在本版保持只读或禁用，`id` 不承担重命名后的身份延续职责。

### 4.1 `confidence` 与 `mode` 的关系

`confidence` 记录 AI 对本次模式判断的把握程度，不是独立的模式决定通道：

- `mode=adversarial` 允许搭配任意 `confidence`；
- `mode=standard` 只允许 `confidence` 为 `high` 或 `medium`；
- 规范化层遇到 `confidence=low` 且 `mode=standard` 时，直接改写为 `adversarial`，并在 `rationale` 追加“判断把握不足，按保守规则采用对抗模式”。

该改写是规范化行为，不判定为响应校验失败，也不触发大纲和逐状态步骤的整体重新生成。这样既满足决策 6 的“不确定时选择对抗”，又避免出现 `low + standard` 这种与决策 6 矛盾的持久化数据。

### 4.2 模式适用性

- `isFinal=true`：不写入 `reviewPolicy`，不显示模式开关，不要求 verdict。
- 其他非终态：写入 `reviewPolicy`。
- `requireHumanApproval=true`：仅表示状态执行后需要人工审批，不影响模式适用性。
- `type: human-checkpoint`：不作为纯人工状态判据。如后续产品需要真正的纯人工节点，应新增 `executionKind: human-gate` 并实现对应运行时语义。

### 4.3 步骤来源与可逆变换

为了安全关闭对抗模式，步骤需要保留来源和系统生成基线：

```yaml
provenance:
  origin: review-policy   # user | ai-draft | review-policy | legacy
  managedRole: attacker   # attacker | judge | standard-closer
  baselineHash: review-step:v1:...
```

`generatedBy: ai | user` 不足以判断能否删除，因为普通业务步骤和对抗专用步骤都可能由 AI 创建。所有 AI 草案步骤写入 `origin=ai-draft` 和基线；只有本地模式编排器插入或接管的 attacker、judge 和标准收口步骤写入 `origin=review-policy`。

`baselineHash` 是变更检测指纹，不是安全边界。统一算法为：对除 `provenance` 外的完整语义步骤对象做递归 key 排序和 JSON 归一化，再使用浏览器/Node 都可同步执行的 FNV-1a 64-bit 计算 `review-step:v1:<hex>`。这样 `preCommands`、subworkflow、并行、Spec 绑定等任意语义字段的修改都会被检出。

AI 输出不得直接决定 `id`、`agentInstanceId` 或 `provenance`；规范化/装配层忽略模型返回的这些管理字段，由本地代码生成、保留和校验。用户手工编辑不刷新基线；只有用户确认本地 reconciler 产生的系统变换后才刷新。用户选择“保留并转为普通步骤”时，将 `origin` 改为 `user` 并清除 `managedRole/baselineHash`。

只有同时满足以下条件的步骤才能自动删除：

1. `origin=review-policy`；
2. `managedRole` 是 attacker 或独立 judge；标准收口步骤只能在本地 reconciler 确定有可替代 verdict 输出者时删除；
3. 当前字段计算的 hash 与 `baselineHash` 一致；
4. 没有使删除变得不安全的外部引用。

hash 不一致、缺少来源元数据或来自旧配置时，必须进入 diff，默认保留并让用户选择“删除”或“保留并转为标准验证/收口步骤”。

### 4.4 配置级策略与运行级方案必须分层

状态上的 `reviewPolicy` 是可复用工作流的持久化基线；它描述“这个工作流平时如何编排”。复用启动时新增的全局意愿不能直接改写该字段，而是生成一个仅属于本次 run 的 `RunReviewPlan`：

```ts
type WorkflowAdversarialIntent = 'disabled' | 'on-demand';

interface RunReviewPlanState {
  configFile: string;
  stateId: string;
  stateName?: string;
  baseMode: 'standard' | 'adversarial';
  suggestedMode?: 'standard' | 'adversarial';
  effectiveMode: 'standard' | 'adversarial';
  source: 'global' | 'config' | 'ai' | 'user';
  locked: boolean;
  inheritedConfigLocked?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  rationale?: string;
  riskSignals?: string[];
}

interface RunReviewPlan {
  planId: string;
  preference: WorkflowAdversarialIntent;
  rootConfigFile: string;
  baseConfigHash: string;
  contextHash: string;
  createdAt: string;
  expiresAt: string;
  states: RunReviewPlanState[];
}
```

关键语义：

1. `{configFile, stateId}` 是运行树内的复合身份；`stateName` 只用于显示和旧无 ID 配置回落。
2. `baseMode` 来自原配置，`suggestedMode` 是本次任务上下文下的 AI 建议，`effectiveMode` 是全局约束和用户覆盖后的最终执行模式。
3. `source=config` 表示沿用原配置，`source=global` 表示被“不开启对抗”硬约束改写；`source=ai/user` 分别表示本次运行建议和人工覆盖。
4. `locked` 是运行级锁，只保护本次方案。原配置中的 `reviewPolicy.locked=true` 会阻止 AI 自动改写基线建议，但用户仍可明确覆盖本次运行；该覆盖不得回写原配置。
5. `planId` 对应服务器持有的短期启动方案，建议 15 分钟过期。最终启动时必须重新校验 `baseConfigHash/contextHash`，拒绝过期或 stale 方案。
6. 服务端不信任客户端提交的 `source/locked/id/provenance/agentInstanceId` 等管理字段。客户端只提交全局意愿和明确的逐状态用户覆盖，管理字段由服务端生成。

`baseConfigHash` 应是完整依赖图的稳定 hash：按规范化 `configFile` 排序，对每个文件的内容 SHA-256 组成 canonical JSON 后再计算；不能直接复用包含 `createdAt` 的 snapshot `manifestHash`。`contextHash` 对规范化后的 task input、工作目录、全局上下文、状态上下文和 rehearsal 标记计算，不包含 UI 临时字段。

运行级有效配置是 `RunReviewPlan` 的执行投影，不是新的工作流资产。服务器应为每个 run 生成不可变快照：

```text
runs/<runId>/
├─ configs/
│  ├─ manifest.json      # 根配置和可达子工作流的快照清单与 hash
│  └─ *.yaml             # 本次运行的有效配置
└─ state.yaml            # PersistedRunState，包含 RunReviewPlan、上下文和运行状态
```

`createWorkflowConfigSnapshot()` 应扩展为可接收按已解析配置路径索引的内容 override 或纯 transform；快照生成后，manager 继续通过 `rootRunId` 读取快照。原 YAML 在预览、启动、恢复、重试和结束阶段都不得被写入。

## 5. AI 引导创建流程改造

### 5.1 最新版创建入口与最终产物

最新版 `dev` 已删除旧的 phase workflow、`/workflow` 斜杠链路和 `create-workflow` 插件。用户可见的创建选择为：

1. 直接创建 `lightweight`：填写单任务目标和执行 Agent，本地装配为固定单状态、单步骤、无转移的任务清单工作流；
2. 直接创建 `state-machine`：编辑显式状态、步骤和转移；
3. `ai-guided`：从 QuickActions、`starterAction=create_workflow`、普通首页对话或工作流页面进入同一个创建会话，AI 收集需求并推荐最终类型，确认后创建 `lightweight` 或 `state-machine`。

`ai-guided` 不得作为 workflow mode 持久化。实际 YAML 中 lightweight 仍使用状态机 schema，但必须带 `workflow.profile: lightweight` 并满足固定拓扑；普通状态机不带该 profile。

最新版迁移分支已按上述三入口重新接线：旧 `/workflow` lightweight 与 `NewConfigModal` full 预算代码只作为历史迁移来源，没有被恢复；创建上下文改用相互正交的 journey、target kind 与 adversarial intent 字段。

### 5.2 共享创建门禁与状态级对抗协议

所有创建入口必须共享：

1. 全局意愿 `disabled | on-demand` 的产品语义和本地硬约束；
2. `lightweight | state-machine` 最终产品类型的本地结构校验；
3. “需要状态级对抗就不能保持 lightweight”的类型门禁；
4. 只有 state-machine 使用“最小充分”的至少 2 状态底线和 `reviewPolicy.mode/source/locked/rationale/riskSignals/confidence`；
5. 可配置状态范围：普通状态机非终态适用，终态和 lightweight 固定状态不适用；
6. standard/adversarial 判断标准和“不确定时选择 adversarial”规则；
7. standard 的执行/验证 → 最后串行步骤内联 verdict 编排；
8. adversarial 的 defender 组 → attacker → judge 编排；
9. 对抗角色运行实例独立、Supervisor 解耦和运行时证据上下文要求；
10. 步骤来源、用户修改识别和关闭对抗的可逆变换；
11. 用户覆盖、锁定、交还 AI 判断和差异预览；
12. 旧配置推断、运行时 verdict 和三路转移语义。

创建上下文应分别保存 `creationJourney: direct | ai-guided`、`targetWorkflowKind: lightweight | state-machine` 和 `creationAdversarialIntent: disabled | on-demand`；AI 引导路径把它们放入创建会话，直接创建路径至少保留在当前表单状态与最终提交校验中。若仍需区分计划深度，可另用 `planningDepth: compact | detailed`，但不得继续使用 `creationProfile: lightweight | full`。

### 5.3 改造后的共享流水线

1. **入口识别**：记录 `direct | ai-guided`，不要预先把 `ai-guided` 映射成 state-machine。
2. **全局意愿**：任何会触发 AI 评估的创建流程都必须先选择 `disabled` 或 `on-demand`；意愿未选择时不得调用 AI。
3. **上下文聚合**：加载需求、Agent、工作目录和可选 Spec；`on-demand` 注入产品类型门禁和风险判断规则，`disabled` 注入“不得生成对抗”的硬约束。
4. **产品类型与整体风险初判**：AI 引导在同一次规划结果中返回 `workflowKind`、类型理由和整体风险判断。`disabled` 只按结构复杂度推荐类型；`on-demand` 必须把实际对抗需求纳入类型选择。
5. **本地产品类型门禁**：`lightweight + requiresAdversarial=true`、`lightweight + confidence=low` 或 lightweight 草案夹带多状态/多步骤/转移均视为矛盾结果，只局部修复为 state-machine 规划，不保存无效轻量配置。
6. **按最终类型分流**：
   - `lightweight`：本地固定装配 1 个 initial/final 状态、1 个 Agent 步骤、0 个转移和内部 `aceharness-tasklist`，不生成状态级 `reviewPolicy`；
   - `state-machine`：按最小充分原则生成大纲；仅 `on-demand` 为每个非终态输出初始 `reviewPolicy`，`disabled` 由本地装配层强制 standard。
7. **逐状态模式确认与步骤生成**：仅 state-machine 复用逐状态步骤调用；`on-demand` 在同一次响应中确认或修正大纲初判，`disabled` 只生成标准业务步骤：
   - `standard`：生成 1～N 个执行/验证步骤，最后一个串行步骤内联输出 verdict；
   - `adversarial`：生成 defender 段、attacker 步骤、最终 judge，保证角色顺序和证据可见性。
8. **角色解析**：AI 只返回 `role/agent/task/constraints`；本地装配层为三个角色生成独立 `agentInstanceId`、隔离上下文、步骤来源和基线指纹。可复用同一 Agent 配置；没有任何可执行 Agent 或无法建立隔离实例时才暂停。
9. **组装与校验**：按最终产品类型运行对应 schema 校验，并校验全局意愿、模式、角色、步骤顺序、转移、Agent 可用性和 Spec 绑定。
10. **草案预览**：显示最终产品类型和理由。lightweight 不显示逐状态开关，只提供“保持轻量”或“升级为状态机”；state-machine 展示逐状态模式、理由、diff 和锁定。
11. **确认与保存**：最终 YAML 只持久化合法 lightweight 或普通 state-machine；创建会话中的 `ai-guided` 不进入 YAML。
12. **后续重评估**：普通状态机单状态使用 state scope 补丁；批量重评估返回按稳定状态 ID 定位的窄补丁。轻量工作流要求对抗时先转换为状态机草案。

创建时的 `on-demand` 不增加固定的模式判断专用调用。AI 引导继续以一次首轮规划同时决定产品类型、整体风险和必要的状态机大纲；只有最终选择 state-machine 才产生 N 次非终态步骤调用。矛盾输出只修复当前规划 item，不重跑完整会话。`disabled` 不请求模型判断对抗模式，本地强制 standard。

`on-demand` 创建期的 AI 响应结构扩展为：

```ts
interface WorkflowCreationPlanItem {
  workflowKind: 'lightweight' | 'state-machine';
  workflowKindRationale: string;
  reviewAssessment: {
    requiresAdversarial: boolean;
    rationale: string;
    riskSignals: string[];
    confidence: 'high' | 'medium' | 'low';
  };
  states: WorkflowOutlineStateItem[];
}

interface WorkflowOutlineStateItem {
  name: string;
  description?: string;
  isInitial?: boolean;
  isFinal?: boolean;
  transitions?: unknown[];
  reviewPolicy?: {
    mode: 'standard' | 'adversarial';
    source: 'ai';
    locked: false;
    rationale: string;
    riskSignals: string[];
    confidence: 'high' | 'medium' | 'low';
  };
}

interface WorkflowStateStepsItem {
  stateName: string;
  reviewPolicy: {
    mode: 'standard' | 'adversarial';
    source: 'ai';
    locked: false;
    rationale: string;
    riskSignals: string[];
    confidence: 'high' | 'medium' | 'low';
  };
  steps: WorkflowStep[];
  transitions?: unknown[];
}
```

`workflowKind=lightweight` 时 `states` 只作为规划说明使用，最终固定拓扑由本地装配，所有 state `reviewPolicy` 必须为空，且 `reviewAssessment.requiresAdversarial` 必须为 false。`workflowKind=state-machine` 时终态的 `reviewPolicy` 必须为空；`on-demand` 的非终态 `workflow_state_steps.reviewPolicy` 必填。`applyWorkflowCreationItem` 应在保存 steps/transitions 的同时，用逐状态响应更新匹配的 `outlineState.reviewPolicy`，最终装配以该值为权威结果。`disabled` 不要求模型返回这组字段，由本地装配层为非终态写入持久化 standard 策略。

逐状态步骤响应可以改变初判的 mode，但必须在同一响应中返回与新 mode 一致的 steps。仍无法确定时直接定稿为 `adversarial`，不发起第三次裁决调用；如果响应返回 `confidence=low` 且 `mode=standard`，按 4.1 由规范化层直接改写为 `adversarial`，不退回重试。新增字段的格式错误仅重试当前 outline/state item，每项最多两次；不因 policy 字段错误重跑整个“1+N”草案。

### 5.4 Lightweight 最终产品

- 创建来源：直接轻量创建，或 AI 引导推荐并经用户确认；
- 目标：围绕一个明确目标，由一个执行 Agent 使用任务清单动态拆分、调度和验收；
- 固定结构：`workflow.mode=state-machine`、`workflow.profile=lightweight`、1 个 initial/final 状态、1 个 Agent 步骤、0 个转移；
- 能力约束：内部强制 `aceharness-tasklist`，不配置 subworkflow、Supervisor、可选步骤 Skills 或状态级 `reviewPolicy`；
- 全局意愿：disabled 可直接装配；on-demand 先做整体风险门禁，只有无需对抗时才能保持 lightweight；
- 转换：AI 或用户判定需要对抗时，重新规划为普通 state-machine 并再次确认，不能原地扩充轻量拓扑。

### 5.5 State-machine 最终产品

- 创建来源：直接状态机创建，或 AI 引导推荐并经用户确认；
- 目标：生成可追踪、可修订、可正式保存的多状态工作流；
- 上下文：可使用补充问答、Spec、设计决策、结构化任务、参考工作流、推荐 Agent 和工作目录；
- 状态：按最小充分原则生成，极简结构允许“执行 → 完成”；
- 步骤：根据 `reviewPolicy` 生成标准或对抗结构；启用 Spec 时绑定真实叶子任务、需求和产物证据；
- 角色：优先推荐不同 Agent 配置以提高观点多样性，也允许使用同一配置的三个隔离实例兜底；
- 确认：展示产品类型、状态大纲、逐状态模式、正式计划和 workflow 草案，再校验保存。

### 5.6 新建工作流的全局意愿门禁

直接轻量、直接状态机和 AI 引导创建都必须选择全局意愿；凡是会触发 AI 评估的路径，都必须在第一次 AI 调用之前询问：

```text
是否允许这个工作流使用对抗流程？
○ 不开启对抗
  轻量工作流保持无对抗；状态机所有非终态都使用标准模式，AI 不能开启对抗。
○ 按需开启
  AI 先判断能否保持轻量；状态机再按每个非终态给出建议，用户可调整并锁定。
```

该门禁共享同一个字段 `creationAdversarialIntent: 'disabled' | 'on-demand'`，但后续按创建旅程和最终产品类型分流：

- 直接 lightweight：disabled 直接创建；on-demand 先做整体风险评估，若需要对抗则要求切换到 state-machine；
- 直接 state-machine：disabled 强制所有非终态 standard；on-demand 在状态结构确定后给出逐状态建议；
- ai-guided：选择后由同一规划会话推荐 lightweight 或 state-machine，草案展示类型理由；
- `disabled`：提示词不要求模型判断 mode，本地装配层忽略模型夹带的 adversarial 结果，给所有非终态写入 `mode=standard, source=user, locked=true`，并保证不生成 attacker/独立 judge；
- `on-demand`：轻量候选先经过整体风险门禁；普通状态机复用状态大纲初判、逐状态步骤调用确认，用户在草案确认时可覆盖；
- 用户在 AI 开始生成前可以返回修改意愿；草案已经生成后修改意愿必须重新本地协调全部状态并展示 diff，不允许静默重跑或静默改写。

普通状态机中的 `source=user, locked=true` 表示用户对新工作流状态作出的持久化选择。它与 4.4 的运行级锁不是同一份数据：新建结果保存后成为配置基线，复用启动的选择只进入 `RunReviewPlan`。lightweight 不制造状态级 policy；其全局意愿只作为创建会话决策证据，最终结构仍由 lightweight schema 表达。

## 6. AI 模式判断规则

### 6.1 优先选择对抗模式

- 架构、接口契约、权限、安全、隐私或数据模型变更；
- 跨模块、跨仓库或跨团队影响；
- 不可逆或恢复代价高的操作；
- 状态产出会成为多个下游阶段的输入；
- 需求、方案或证据存在明显不确定性；
- 错误可能静默传播，普通自动化验证难以发现；
- 用户明确要求挑战、红蓝审查或独立裁决。

### 6.2 优先选择标准模式

- 行为确定、可自动验证、容易回滚的机械操作；
- 汇总、格式转换、交付打包等低风险工作；
- 对抗审查已经由上游状态完成，本状态只执行已锁定结论；
- 终止状态不进入模式判断，应标记为不适用而不是标准模式开关。

AI 输出理由必须引用该状态的具体交付物和风险，不得只写“该状态很重要”或依据状态名称判断。

## 7. 模式编排规则

### 7.1 标准模式

```text
执行步骤（可多个） → 验证步骤（可选） → 最后一个串行步骤内联 verdict
```

- 默认不自动创建独立 judge；
- 最后一个串行执行或验证步骤在同一次调用中输出工作结果和 `pass | conditional_pass | fail`；
- 不自动创建 attacker；
- 同一目标下可使用 `parallelGroup` 并行执行；如果状态以并行组结尾，必须保留或生成一个串行汇总/收口步骤输出 verdict。

### 7.2 对抗模式

```text
defender 步骤组（可并行） → attacker → judge
```

- defender 产生状态交付物和支持证据；
- attacker 必须通过运行时证据上下文读取全部 defender 产出，其 task/constraints 由共享系统协议强制注入“主动寻找反例、边界、遗漏和错误假设，不得仅复述 defender 结论”，不依赖 Agent 配置自身的队伍人格；
- judge 必须通过同一上下文同时读取 defender 和 attacker 证据；
- defender、attacker、judge 使用不同运行实例和隔离会话；
- adversarial defender 并行组只允许 `joinPolicy=all`，不允许 any/quorum、detach 或提前 join；一个 defender 技术失败或超时即将状态判为 fail，不继续 attacker；
- attacker 技术失败或超时同样直接 fail，不降级 standard、不继续 judge；重试仍使用现有步骤/状态恢复机制；
- 只有 judge 可以决定状态流转。

第一版不定义可独立持久化的 EvidenceBundle。运行时可以用以下内存结构组织现有输出，再格式化注入后续角色提示词：

```ts
interface RuntimeEvidenceItem {
  stepId: string;
  stepName: string;
  role?: 'defender' | 'attacker';
  agentInstanceId?: string;
  output: string;
  conclusion?: string;
  outputRef?: string;
  truncated?: boolean;
}
```

该结构只是对现有 step output/结论的运行时分组，底层以已持久化的 `stepLogs` 为权威恢复来源；`StateExecutionResult.stepOutputs` 不是唯一持久化保证。恢复/重跑时必须从已完成 step log 按原执行顺序重建证据上下文。第一版不增加独立文件、数据库表、run document 或证据查看器。

证据注入预算是运行时固定协议，不依赖创建旅程、最终产品选择前的 `planningDepth` 或其他未持久化创建元数据：

- 每个证据项必须保留 metadata、`step-conclusion` 和 `outputRef`；结论最多 2,000 字符；
- 原始输出摘要每项最多 8,000 字符，整个状态证据上下文最多 32,000 字符；
- 所有 defender 项都必须出现；超限时按项目数公平分配剩余预算，保留结尾裁决/结论片段并显式标记截断；
- attacker 只注入 defender 证据；judge 注入 defender + attacker 证据；Memory V2 只作为增强检索。

### 7.3 Agent 身份与编队字段语义

| 字段 | 权威语义 |
|---|---|
| `step.role` | 当前状态中的执行职责：defender / attacker / judge |
| `step.agent` | 使用的 Agent 配置、能力和人格 |
| `step.agentInstanceId` | 本次执行的独立身份、会话和上下文 |
| `agent.team` | 选人偏好和编队展示信息 |

硬约束是角色实例不相交且上下文隔离：

1. defender 可有多个步骤，但所有并行 defender branch 的 `agentInstanceId` 必须互不相同；
2. defender 实例集合、attacker 实例和 judge 实例两两不相交；
3. attacker 必须串行、judge 必须串行且是状态最后一个执行 segment；
4. 任一角色实例 ID 不得与 Supervisor 运行名称相同；
5. 运行时初始化后，不同角色 runtime agent 不得持有相同的非空 sessionId；发现重用时硬失败。

Agent 配置名可以相同，底层模型也可以相同。选人时优先使用 `attacker → blue`、`defender → red`、`judge → judge`；第一版对 team 不匹配显示警告而不阻塞。`black-gold` Supervisor 不允许承担三个执行角色。界面同时显示队伍名和步骤角色，避免将仓库现有“蓝队=攻击、红队=防守”语义与安全行业惯例混淆。

运行时必须对串行步骤同样优先使用 `agentInstanceId || agent`，不能只在并发组中使用 `agentInstanceId`。

第一版不向 `workflow.concurrency.agentInstances` 写入重复登记；步骤上的 `agentInstanceId` 是状态机运行时的唯一配置来源。

### 7.4 关闭对抗的可逆变换

1. 保留业务执行/验证步骤，对原 defender 步骤去除 defender 标签；
2. 删除明确由 review-policy 生成且 hash 未变的 attacker；
3. 如果剩余步骤以串行步骤结尾，删除未修改的独立 judge，改由最后串行步骤内联裁决；
4. 如果剩余步骤以并行组结尾，将原 judge 转为无 judge 角色的标准汇总/收口步骤，并将 `managedRole` 改为 `standard-closer`、刷新系统基线；
5. 用户修改过、来源不明或存在外部引用的 attacker/judge 不自动删除，必须在 diff 中选择删除或转为标准验证/收口步骤；
6. 变换后必须重新校验最终 verdict 输出者和三路转移。

第 3 条隐含一个对保留步骤的改写：原 defender 步骤只产出交付物、不输出裁决，内联裁决要求它在同一次调用中追加输出 `pass | conditional_pass | fail`，因此它的 `task` 必须被追加裁决输出要求。该改写按以下规则处理：

- 改写保留步骤的 `task` 属于用户可见变更，必须出现在 diff 中，不得静默应用；
- 只有 `origin=review-policy` 或 `origin=ai-draft` 且 hash 未变的步骤可以被自动改写；
- `origin=user` 或 hash 已变的步骤一律不改写，无论用户是否接受删除 judge。

由此产生的死结是：最后一个串行步骤是用户步骤、不可改写，而独立 judge 又被删除，导致没有步骤输出 verdict。此时不动用户步骤，在末尾生成一个 `managedRole=standard-closer` 的 review-policy 托管独立收口步骤，并在 diff 中标注“为保留你的步骤内容，新增了一个裁决收口步骤”。这是标准模式的显式例外调用，不得称为“内联裁决”。

第 6 条的校验因此不会出现无解情况：校验发现没有 verdict 输出者时，一律走“新增托管收口步骤”这条出口，而不是回退整个模式切换或改写用户内容。

### 7.5 终态汇总

终态可保留一个汇总步骤生成人类可读的结果、已验证内容和剩余风险，但该步骤不设置 `role: judge`，不输出 verdict，不参与状态模式或旧对抗结构识别。

### 7.6 对抗状态的重试与熔断

AI 生成的状态默认把 `fail` 指向自身，因此每个对抗状态都自带一条自循环回路。对抗状态每轮至少三次角色调用，且 judge 的输入包含全部 defender 与 attacker 证据，单轮成本显著高于标准状态。按现有默认值（`maxSelfTransitions: 3`），一个对抗状态最坏执行四轮、十二次角色调用，足以抵消整条工作流通过模式分级省下的开销。

因此对抗状态使用独立的重试与熔断规则。

**1. 独立自循环上限。** 对抗状态默认 `maxSelfTransitions: 2`，标准状态维持默认 3。取 2 而非 3 的理由是对抗审查已是最贵的手段，其 `fail` 是三方独立得出的强信号，反复自动重试的边际收益递减；取 2 而非 1 的理由是重试轮已按规则 2 降级，单轮成本降至两次调用，多保留一轮自我修复机会的代价可接受。用户可显式调高，界面需给出轮次与预估成本提示。

**2. 重试轮降级编排。** 自循环回到同一对抗状态时不重复完整三角色：

```text
首轮    defender 组 → attacker → judge      （完整对抗）
重试轮  defender 修复 → judge 复核           （不重跑 attacker）
```

- 上一轮 attacker 的发现和 judge 的裁决通过运行时证据上下文注入重试轮的 defender 与 judge；
- 重试轮 defender 的任务范围限定为修复上一轮已识别问题，不引入新的交付面；
- 重试轮 judge 的复核范围包含两项：已识别问题是否修复，以及 defender 的修改是否引入了未经攻击审查的新变更。判定为引入新变更时必须输出 `fail`；
- 第二个重试轮的“新变更”判定以首轮 attacker 实际审查过的范围为基准累计计算，不只对比上一轮，避免连续两轮小幅改动累积成未经审查的大改；
- 降级只作用于自循环重试轮，重新进入该状态（从上游转移而来）仍按完整对抗执行；
- 降级不改变角色实例隔离要求，重试轮的 defender 与 judge 仍使用各自独立实例。

按规则 1 与规则 2，对抗状态最坏成本从十二次角色调用降至七次：首轮完整对抗三次，两个降级重试轮各两次。

**3. 熔断出口按模式分岔。** 现有熔断在触发后会在转移表中查找第一个非自身目标并强制转向，按默认生成的转移表通常即为下游状态，且该路径会跳过 `requireHumanApproval` 检查。对抗状态不适用该行为：连续失败到达上限的高风险状态被自动放行，与开启对抗的目的相反。

- `mode=adversarial` 的状态触发熔断时进入人工审批节点，不强制转向下游；审批界面需同时呈现各轮 defender 产出、attacker 发现与 judge 裁决；
- `mode=standard` 的状态维持现有强制转移行为；
- 对抗状态的熔断目标不得依赖转移数组顺序隐式决定。

熔断审批只接受三种显式动作，不提供隐式默认值：

| 动作 | 语义 | 落地要求 |
|---|---|---|
| 放行 | 接受当前产出，按 `pass` 语义前进 | 记录为人工放行，`stateHistory` 中标注熔断来源与操作人，不伪装成 judge 裁决 |
| 回退 | 返回某个上游状态重做 | 目标由用户从可达上游状态中显式选择，不使用默认回退目标；进入目标状态后重置该状态的 `reviewCycleId` 与自循环计数 |
| 终止 | 结束本次运行 | 运行最终状态落为 workflow `failed`，不得实现为转移到终态或任何其他状态 |

“终止”必须落为 `failed` 而不是状态跳转：熔断现有实现是通过强制转移达成的，如果终止也做成转移，运行会在列表中显示为 completed，把一次未通过审查的运行伪装成正常完成。

规则 1 和规则 2 是成本控制。规则 3 不产生节省，属于语义修正——它保证前两条省下的开销不是靠放松把关换来的；引入人工介入后，对抗状态的平均端到端时长可能上升。

## 8. 用户交互

### 8.1 状态列表

- 标准状态显示“标准”徽标；
- 对抗状态显示“对抗”徽标；
- 用户锁定的状态显示锁定标识；
- 终态不显示可操作开关。

### 8.2 状态详情

提供：

- 标准/对抗开关；
- AI 判断理由；
- 来源和锁定状态；
- defender、attacker、judge 的 Agent 配置和运行实例绑定；
- “AI 重新评估”或“交还 AI 判断”；
- 应用前 diff：新增、删除、保留和重新绑定的步骤，以及“删除”/“转为标准验证步骤”选项；
- 关闭对抗时，diff 还需显式展示两类变更：保留步骤的 `task` 被追加裁决输出要求，或为保留用户步骤而新增 review-policy 托管收口步骤。

模式切换必须先生成编排补丁并展示差异，不能在用户点击开关后静默改写步骤。

### 8.3 锁定和批量重评估

本字段是“审查模式锁”，不是整个业务状态的通用编辑锁。`locked=true` 冻结：

- `reviewPolicy` 本身；
- `origin=review-policy` 的托管步骤及其顺序、角色、Agent 绑定和来源元数据；
- 与当前模式直接相关的本地 reconciler 结果。

不相关的业务步骤仍可由用户手工修改；普通 state/workflow AI 优化也可修改业务内容，但所有 AI 补丁应用入口都必须由代码回填上述受保护切片。“交还 AI 判断”只创建带显式解锁意图的重评估候选并产生 diff；当前草稿在用户确认前仍保持锁定，确认时解锁和新策略一起应用。

批量重评估不可复用“AI 返回完整 workflow 并整体替换”的优化方式。AI 只判断目标 policy，不返回步骤增删或管理元数据：

```ts
interface ReviewPolicyPatch {
  stateId?: string;
  stateName?: string; // 仅旧无 ID 状态允许回落
  expectedStateHash: string;
  reviewPolicy: {
    mode: 'standard' | 'adversarial';
    rationale: string;
    riskSignals: string[];
    confidence: 'high' | 'medium' | 'low';
  };
}
```

步骤结构变更由本地纯函数 `reconcileReviewPolicy(baseState, targetPolicy)` 生成结构化 diff，而不是由 AI 随意返回 state/workflow：

```ts
type ManagedStepOperation =
  | { op: 'insert'; step: WorkflowStep; afterStepId?: string }
  | { op: 'delete'; stepId: string; reason: string }
  | { op: 'retag'; stepId: string; role?: 'defender' | 'attacker' | 'judge' }
  | { op: 'convert'; stepId: string; target: 'validation' | 'standard-closer'; preserveUserFields: boolean };
```

该 reconciler 是生成 `id/agentInstanceId/provenance/baselineHash`、关闭对抗可逆变换和角色顺序的唯一权威实现。AI 补丁中即使夹带这些字段也一律忽略。

生成候选 diff 时记录 `expectedStateHash`。应用层必须：

1. 从最新 draft 按 ID/名称重新查找状态，不使用候选生成时的 index；
2. 重新检查 `locked` 和受保护切片；锁定状态的模式补丁拒绝或忽略，并报告数量；
3. 重算当前状态 hash，与 `expectedStateHash` 不同时判定 stale，拒绝应用并要求重新生成 diff；
4. 禁止通过重评估补丁删除、重命名、重排状态或修改无关字段；
5. 应用后深比较锁定的受保护切片，与应用前不同则拒绝整个结果；
6. 提示词中的“不要修改锁定状态”只是辅助约束，不是安全边界。

### 8.4 复用已有工作流：启动上下文中的运行级意愿

#### 8.4.1 入口与术语

真实入口是工作流工作台右上角的“启动工作流”。用户打开已有工作流后，系统显示现有的“设置启动上下文”弹窗，填写本次任务、参考资料、期望结果、工作目录、全局上下文和状态上下文。这里的“复用”只创建新 run，不创建或保存工作流副本。

启动弹窗改为两步：

1. **设置本次运行**：保留现有上下文字段，并新增必选的全局意愿“不开启对抗 / 按需开启”。主按钮改为“下一步：确认本次运行方案”。
2. **确认本次运行方案**：展示原配置模式、本次 AI 建议、最终有效模式、来源、理由、风险信号、角色/Agent 可用性、预计额外调用和结构化 diff。确认后点击“确认方案并启动”。

`disabled` 下不显示可操作的逐状态开关：lightweight 保持固定结构，普通状态机所有非终态的有效模式为 `standard`。`on-demand` 下普通状态机允许逐状态覆盖；lightweight 先展示“保持轻量 / 本次派生状态机对抗执行”的整体建议，只有派生为状态机后才展示逐状态覆盖。用户覆盖立即成为本次运行的 `source=user, locked=true`，但在最终确认前不生成 run、不修改任何文件。

#### 8.4.2 运行级规划顺序

```text
打开已有工作流
  → 点击“启动工作流”
  → 填写本次运行上下文
  → 选择全局意愿
  → 服务端构建 RunReviewPlan
      disabled：本地确定性协调，不调用 AI
      on-demand：普通状态机批量评估；lightweight 整体风险评估
  → 展示最终运行产品类型、有效模式、diff、Agent/成本检查
  → 用户按需覆盖并锁定本次选择
  → 确认方案
  → 生成根配置和全部子工作流的有效快照
  → 针对有效快照重新执行 preflight
  → 创建并启动 run
```

当前弹窗中的 preflight 发生在运行方案确定之前，不能继续作为最终准入结果。可以保留早期提示，但最终启动必须在有效快照生成后重新检查，并把最终检查结果绑定到 `planId/baseConfigHash/contextHash`。

#### 8.4.3 两种意愿的协调行为

| 原配置产品 | 全局意愿 | AI 调用 | 控制方式 | 有效快照行为 |
|---|---|---:|---|---|
| lightweight | `disabled` | 0 | 无状态级开关 | 保持原 lightweight 固定拓扑，只更新本次运行上下文 |
| lightweight | `on-demand` | 通常 1 次整体评估 | “保持轻量 / 本次状态机对抗执行” | 无需对抗时保持 lightweight；需要对抗时派生至少“执行与对抗 → 完成”的普通 state-machine run snapshot |
| state-machine | `disabled` | 0 | 状态级开关禁用 | 所有非终态强制 standard；安全删除托管 attacker/judge，用户内容保留并去除对抗角色，必要时补 standard closer |
| state-machine | `on-demand` | 通常 1 次批量规划 | 可逐状态覆盖 | AI 根据“原配置 + 本次任务/上下文”建议模式；本地 reconciler 装配步骤，确认后的有效配置只进入本次 run 快照 |

4.3 的“来源不明步骤不得自动删除”仍然成立。运行级 `disabled` 采用确定性的保守策略：不删除用户内容，只把不能安全删除的 attacker/judge 保留并转成普通 standard 执行/验证步骤；用户确认的是整份本次运行 diff，原配置没有任何删除操作。

`on-demand` 是一次“运行级规划操作”，不是每个状态一次模型调用。通常把根工作流、可达子工作流以及 lightweight 的整体任务风险放在一次结构化请求中；超出上下文预算时允许按 `configFile` 分组，仍不得退化为 N 个逐状态调用。AI 返回值必须是窄建议：

```ts
type RunReviewSuggestion =
  | {
      kind: 'lightweight';
      configFile: string;
      requiresAdversarial: boolean;
      confidence: 'high' | 'medium' | 'low';
      rationale: string;
      riskSignals: string[];
    }
  | {
      kind: 'state';
      configFile: string;
      stateId: string;
      mode: 'standard' | 'adversarial';
      confidence: 'high' | 'medium' | 'low';
      rationale: string;
      riskSignals: string[];
    };
```

AI 不返回状态/步骤全集，也不返回 `id/provenance/agentInstanceId/source/locked`。普通状态机由服务端按最新配置复合键定位状态，应用置信度规则和配置锁保护，再调用 `reconcileReviewPolicy()` 生成候选有效状态与 diff。lightweight 的 `requiresAdversarial=true` 由本地确定性派生器生成普通状态机 run snapshot；模型不得直接返回派生步骤或伪造 lightweight 多步骤结构。

#### 8.4.4 启动 API 边界

建议在保持现有 `/api/workflow/start` 兼容的前提下新增预览端点：

```text
POST /api/workflow/start/plan
  输入：configFile、mode、initialContexts、adversarialIntent、rehearsal
  输出：planId、RunReviewPlan、结构化 diff、Agent/成本检查、有效配置投影的 preflight 预览

POST /api/workflow/start
  新增：startPlanId、stateReviewOverrides
  行为：校验 plan TTL/config hash/context hash → 服务端应用用户覆盖
       → 生成 run 级有效配置快照 → 重跑 preflight → 启动
```

短期 `startPlan` 存在服务端，不把完整权威 plan 交给客户端回传。客户端的 `stateReviewOverrides` 只包含 `{configFile, stateId, effectiveMode}` 和明确的用户确认；服务端重新生成 `source=user, locked=true`。过期、配置已变化、上下文已变化或状态已不存在时返回 stale，要求重新预览。

对于尚未升级的 API 调用方，`adversarialIntent` 缺失时维持原配置模式，不调用新 AI 规划，也不改写快照；这是临时兼容路径，不是 UI 中的第三个产品选项。

#### 8.4.5 快照、恢复与子工作流

- `createWorkflowConfigSnapshot()` 解析完整子工作流图后，对每个配置应用运行级 transform，再写入 `runs/<runId>/configs/*`；
- `disabled` 必须级联到所有可达子工作流，否则子流程仍可能运行 attacker/judge，违反全局意愿；
- `on-demand` 的确认页按配置分组展示普通状态机状态和 lightweight 整体建议，但最终是一份原子 `RunReviewPlan`；任一硬校验失败时不创建部分 run；
- lightweight 派生快照必须移除 `profile: lightweight` 与轻量专用字段，生成合法普通状态机结构，并保留原任务、Agent、工作目录、Skills/MCP/RAG 等允许继承的运行上下文；
- `state.yaml` 对应的 `PersistedRunState` 持久化 plan 与 snapshot manifest 引用；事件存储快照同步保留恢复所需字段；resume、retry、force jump 和人工审批后继续运行都使用同一份配置快照；
- 原配置在启动后发生变化，不影响当前 run；新变化只对下一次启动重新规划时生效。

#### 8.4.6 演练模式和失败处理

- 演练和正式运行使用相同的 `RunReviewPlan` 规则；从演练转正式运行时必须重新校验配置和上下文 hash，不能盲用过期 plan；
- `on-demand` 的 AI 评估失败时提供“重试判断”和“手工完成本次选择”，不得自动把所有状态降为 standard；
- 任何 `confidence=low` 的建议在规范化后都为 adversarial；
- 角色实例隔离、Agent 可执行性和会话冲突在确认启动前检查。无法建立隔离实例时阻塞该 run，不修改原配置；
- 用户取消第二步时，丢弃短期 plan，不生成 run、快照或持久化模式变更。

### 8.5 权限优先级

权限从高到低固定为：

```text
系统不变量
├─ 终态永不参与模式配置
├─ lightweight 固定拓扑不得直接承载状态级对抗
└─ 本次全局意愿
   ├─ 不开启：lightweight 保持无对抗；普通状态机所有非终态强制 standard
   └─ 按需开启
      ├─ lightweight：AI 提整体建议，用户决定保持轻量或本次派生状态机
      └─ state-machine：进入状态级决定
         ├─ 原配置锁：限制 AI 自动重评估，但不限制用户明确的本次运行覆盖
         ├─ AI：只提出未锁定状态的初始建议
         ├─ 用户：可逐状态覆盖，覆盖后仅在本次运行锁定
         └─ 本地 reconciler：只执行已确认决策，不拥有模式决策权
```

新建普通 state-machine 的全局选择通过最终状态 policy 写入配置基线；新建 lightweight 不制造 policy，其固定结构表达“当前没有状态级对抗”，创建意愿只保留在创建会话/可观测元数据中。复用场景中的同名选择只写入 `RunReviewPlan`。UI 必须在文案和来源徽标上区分“工作流配置”和“本次运行”，避免用户误以为启动一次就修改了以后所有运行。

## 9. 兼容与迁移

读取没有 `reviewPolicy` 的旧状态时：

1. `isFinal=true`：不适用，必须在检查任何步骤角色之前排除；
2. 只依据 `step.role` 和执行 segment 严格识别：同一非终态必须是“一个或多个 defender segment → 一个串行 attacker → 一个串行 judge，且 judge 为最后执行 segment”，才推断为 `adversarial`、`source=legacy`；步骤名关键词不参与推断；
3. 其他非终态：推断为 `standard`、`source=default`；
4. 孤立 judge、终态汇总步骤或不完整角色序列不得推断为对抗；
5. `type: human-checkpoint`、`requireHumanApproval` 和“步骤没有 Agent”不得用于推断纯人工等待状态；
6. 旧对抗结构缺少 `agentInstanceId` 时，共享 normalizer 按 `workflow/state/role/stepId-or-index` 确定性派生 state-scoped 运行实例 ID；只读/运行只在内存中补齐，首次保存时才物化；
7. 只读和运行阶段不强制改写原文件；用户首次保存后物化稳定状态 ID、角色实例 ID 和显式 `reviewPolicy`。

旧步骤没有可验证的 `provenance` 和 `baselineHash`，因此模式切换时不得自动删除，必须进入 diff。迁移逻辑需要幂等，同一配置多次加载和保存不得反复改写步骤。

迁移必须通过一个共享纯函数 normalizer 落地，不能只依赖 Zod schema 默认值：

- `GET /api/configs/[filename]`：返回规范化视图供设计页显示，`materializeIds=false`，不写盘；
- 配置验证：返回同一份 normalized 结果，不只把它放在无人消费的校验字段里；
- POST/保存：在序列化前以 `materializeIds=true` 规范化并物化缺失 ID；
- 运行时：`start/resume/rerun/forceJump` 等所有直接 YAML parse 入口在建立 manager 状态前调用同一 normalizer，保证旧对抗配置可获得确定性实例 ID。

运行级意愿上线时不迁移工作流 YAML，也不为旧配置补“默认全局意愿”：

- 新版交互式启动必须显式选择 `disabled` 或 `on-demand`；
- 旧版客户端或自动化调用未传该字段时，暂时按原配置生成普通快照，保持现有行为并记录兼容路径使用量；
- `start-context-store` 继续只保存上下文和工作目录，不默认记忆上一次全局意愿，防止用户无感复用高成本或低保护选择；
- 已经开始的 run 没有 `RunReviewPlan` 时按其既有 snapshot 继续恢复，不在 resume 时补评估；
- 新 run 一旦生成 plan 和有效 snapshot，后续恢复只认该 snapshot，不再次读取原配置决定模式。
- 恢复旧创建会话时，缺少 `creationAdversarialIntent` 表示“用户尚未选择”，不能按 `on-demand` 补默认值。

## 10. 代码实施范围

第一版状态级能力的实现范围见 10.1，分期顺序与放量约束见 10.2。2026-08-04 新增的“新建全局意愿 + 复用运行级意愿”作为 Phase 6 在现有实现上继续开发；它不改变 Phase 0～5 已完成能力的协议，也不能被 10.1 中“推迟设计页批量重评估”的条目误判为延期。

### 10.1 第一版范围与推迟项

判定标准是“不做会产生错误产物”——错误的配置、假对抗、误删用户内容——而不是“不做会体验差或成本略高”。

**最小必要集（第一版必须完成）**

| 类别 | 项目 | 不做的后果 |
|---|---|---|
| 运行时前置 | 串行步骤优先使用 `agentInstanceId` | 三角色复用同一会话，产出自问自答式的假对抗 |
| 运行时前置 | 终态按 `isFinal` 跳过 `parseVerdict` | 新建工作流在终态因缺少裁决 JSON 被判失败并阻塞 |
| 运行时前置 | 运行时证据交接（7.2） | 必须与会话隔离同批。隔离后 attacker/judge 的新会话默认看不到其他角色输出，而 Memory V2 允许初始化失败后禁用；缺少显式交接时对抗会从“假对抗”变成“盲对抗”，attacker 无从审查 |
| 身份稳定 | 步骤稳定 ID 生命周期 | 步骤 ID 由位置派生，diff 的 delete/retag/convert 定位到错误步骤，会误删用户内容 |
| 变换完整 | `standard → adversarial` 正向变换 | 用户拨动开关后系统没有定义好的行为 |
| 变换完整 | `low + standard` 改写后补齐三角色 | 产出标称对抗但缺少 attacker/judge 的配置 |
| 不产生坏配置 | 删除虚构 Agent 兜底，无可执行 Agent 时阻塞 | 生成引用不存在 Agent 的配置，运行到该步骤才失败 |
| 不产生坏配置 | 同步 `skills/aceharness-workflow-creator` 的 SKILL.md、PROMPT.md 与模板 | 模板仍教用户每个状态配三角色，与新默认冲突，分级收益归零 |
| 成本兜底 | 对抗状态默认 `maxSelfTransitions: 2` | 单个对抗状态最坏十二次角色调用，可抵消整条工作流的分级收益 |
| 零成本约束 | UI 禁用修改 `isFinal` 与状态重命名 | 终态语义与 `reviewPolicy` 结构互相污染；转移引用被静默破坏 |

**推迟项（正文保留完整定义，第一版不实现）**

| 推迟项 | 所在章节 | 推迟代价 |
|---|---|---|
| 重试轮降级编排，及其依赖的轮次元数据（`reviewCycleId/reviewRound/entryKind`）与 attacker 结构化审查范围 | 7.6 规则 2 | 对抗状态最坏成本为九次角色调用而非七次。三者必须同批实现：缺少 `entryKind` 时无法区分自动自循环与人工重跑，降级会误伤人工重跑 |
| 熔断出口分岔与审批动作协议 | 7.6 规则 3 | 维持现状，高风险状态失败到上限后被自动放行。该行为是既有实现，不是本方案引入的回归 |
| `expectedStateHash` 全状态指纹 | 8.3 | 退回“应用前重新读取 + 锁定切片深比较”，锁定保护仍然成立，并发编辑下 stale 检测较弱 |
| 持久化的跨请求 `unlockIntent` / CAS 协议 | 8.3 | 第一版在同一设计会话内使用候选级显式解锁意图，并在确认 diff 时原子应用；尚不提供跨重启/跨客户端恢复解锁候选的持久协议 |
| 批量重评估 | 8.3 | 单状态开关与单状态重评估已覆盖主要场景。砍掉后锁定保护只需处理单状态补丁，第一版的保护面小一个数量级 |

推迟不等于取消。上述条款在正文中保留完整定义作为目标状态，实现时按本节裁剪；每一项在对应章节标注“第一版不实现”，避免实现者照正文展开范围。

### Phase 0：运行时前置改动

本阶段不改配置格式、对用户不可见，可独立合入；但不能单独作为对抗功能发布依据，证据交接 Phase 4 同样是放量门槛。

- `getStepRuntimeAgentName` 对串行步骤同样优先使用 `agentInstanceId || agent`，不再要求步骤属于并发组；
- 终态跳过 verdict 强制：`shouldRequireFinalVerdict` 和 `executeState` 的 `useSegmentVerdict` 都必须按 `!state.isFinal` 门控，确保恢复分支、串行和并行路径都不会对终态调用 `parseVerdict`；
- 修正并行分支 verdict 语义：`executeParallelBranches(..., useVerdict=false)` 不得调用 `parseVerdict`，非最终 defender 并行组按技术执行成功判定；只有真正的最终并行裁决段才解析各分支 verdict；
- 新增 adversarial 运行前校验：角色 segment 顺序、实例不相交、Supervisor 冲突、defender `joinPolicy=all`、attacker/judge 串行和 judge 最后；
- 运行中校验不同角色 runtime agent 的非空 sessionId 不重复，重复时硬失败；
- 单元测试：同一 Agent 配置派生的三个角色实例，一次运行内取得的 sessionId 互不相同；
- 单元测试：终态汇总步骤不输出裁决 JSON 时，运行不被标记为失败或阻塞；
- 单元测试：非最终并行 defender 不输出 verdict 仍可成功收集，任一分支失败则不执行 attacker；
- 回归测试：既有并发工作流的实例解析行为不变；既有终态带 `role: judge` 的工作流仍可正常执行。

准入门槛：上述单元测试通过，且 Phase 4 证据交接测试通过后，才允许对外放量 Phase 2/3 功能。

主要入口：

- `src/lib/state-machine/workflow-manager.ts`

### Phase 1：类型与兼容层

- 在 `src/lib/core/schemas.ts` 增加稳定状态 ID 和状态级 `reviewPolicy` schema；
- 在 `WorkflowStep` 增加 `provenance.origin/managedRole/baselineHash`，并实现共享 canonical JSON + FNV-1a 64-bit 指纹工具；
- 扩展 `WorkflowOutlineStateItem.reviewPolicy` 和 `workflow_state_steps.data.reviewPolicy`；
- 实现共享纯函数 normalizer，落到 GET 规范化视图、validate normalized 返回、POST 保存物化和所有状态机运行直接 YAML parse 入口；
- 实现稳定状态 ID 生命周期、唯一性校验、ID-first/无 ID 时 name fallback 定位；
- 实现严格旧角色序列推断和确定性 legacy `agentInstanceId` 派生；
- 实现 `reconcileReviewPolicy` 纯函数、`ManagedStepOperation` 和受保护切片比较；
- 实现 `confidence=low` 且 `mode=standard` 时自动改写为 `adversarial` 的规范化规则，且不触发校验失败；
- 状态 ID 只用于补丁定位；不实现重命名，不改变 `transitions[].to` 的状态名引用语义；
- 明确只有终态不适用；不根据废弃字段或 Agent 绑定情况推断纯人工状态；
- 添加迁移、来源 hash 和序列化测试。

### Phase 2：AI 创建链路

依赖 Phase 0 与 Phase 1。终态汇总步骤停止输出 verdict 与运行时停止强制 verdict 必须同时生效，否则新建工作流会在终态被误判为失败；本阶段写入的 `reviewPolicy`、稳定 ID 和 `provenance` 也要求 Phase 1 的 schema 与规范化层先就位。

- 扩展 `WorkflowOutlineStateItem`，并让 `workflow_state_steps.reviewPolicy` 更新匹配的 outline state，作为最终装配权威值；
- 修改状态大纲示例、提示词、解析和校验；新字段失败只局部修复当前 item，不重跑完整草案；
- 抽取共享产品类型门禁、状态语义和对抗判断提示；分别传递 `targetWorkflowKind`、`creationAdversarialIntent` 和可选 `planningDepth`，不再使用 `creationProfile: lightweight | full`；
- 共享协议强制注入 attacker 的反例/边界/遗漏约束，解决同 Agent 配置复用时的人格一致偏差；
- 接入最新版 AI 引导会话以及直接 lightweight/state-machine 创建入口，不恢复已删除的 `/workflow` 或 `create-workflow` 插件；
- 首轮规划调用输出最终产品类型建议、整体风险和必要的状态机大纲；只有 state-machine 进入逐状态步骤调用，不增加固定专用判断调用；
- 根据逐状态响应中的最终 `reviewPolicy.mode` 生成步骤；
- 所有 AI 草案步骤由本地装配层写入 `ai-draft` 来源和基线；review-policy 托管步骤由 reconciler 写入 `review-policy` 来源、managedRole 和基线；
- `id/agentInstanceId/provenance` 全部由本地代码派生，忽略 AI 返回的同名管理字段，第一版不登记 `workflow.concurrency.agentInstances`；
- 校验对抗模式的运行实例独立性和步骤顺序；
- 终态汇总步骤不再标记 `role: judge`、不要求 verdict；
- 保证部分草案预览也能展示模式。

主要入口：

- `src/components/NewConfigModal.tsx`
- `src/components/WorkflowModeSelector.tsx`
- `src/lib/ai/workflow-creation-items.ts`

### Phase 3：设计页交互

- 在状态列表增加模式和锁定徽标；
- 在状态详情增加模式开关、理由、来源和角色区；
- 模式切换通过本地 `reconcileReviewPolicy` 生成结构化 step ops 和可勾选 diff，按来源与 hash 区分可自动删除和必须用户确认的步骤；
- 现有步骤编辑逻辑从旧对象增量合并，必须保留 `id/provenance` 且不刷新 baseline，不得从零重建后丢弃管理元数据；
- 支持单状态重评估、交还 AI 判断和批量重评估未锁定状态。
- 批量重评估使用按状态 ID 定位的窄补丁，应用层强制保护 `locked=true` 的审查策略和托管编排，不整体替换 workflow；
- 候选保存 `expectedStateHash`，应用前针对最新 draft 重查 ID、lock 和 hash，拒绝 stale candidate；
- “交还 AI 判断”立即生成一次新评估和 diff，不只清理锁定后等待将来批处理；
- 第一版禁用状态重命名入口，保持 `transitions[].to` 的状态名语义。

主要入口：

- `src/components/StateMachineDesignPanel.tsx`
- `src/lib/workflow/design-ai-optimization.ts`

### Phase 4：运行时证据交接与对抗成本控制

角色隔离和终态 verdict 豁免在 Phase 0 完成。本阶段包含证据交接和对抗成本控制，两者都是对外放量门槛，第一版范围见 10.1、放量顺序见 10.2。证据交接不是质量增强：独立 session 默认看不到其他角色输出，Memory V2 又允许初始化失败后禁用，没有显式交接时 attacker/judge 无法完成职责。

证据交接（必须先于放量完成）：

- 在 `executeState` 本地维护有序 `RuntimeEvidenceItem[]`，正常执行每个 defender/attacker 完成后立即累积；resume/rerun 从已持久化 step log 按步骤顺序重建；
- attacker 输入包含全部 defender 证据上下文；
- judge 输入包含 defender 与 attacker 证据上下文；
- 按 7.2 实施每项 2,000 字符结论、8,000 字符原始摘要、32,000 字符状态总预算和公平截断，每个 defender 都保留 metadata/outputRef/截断标记；
- 标准模式最后串行步骤、对抗模式 judge 继续使用严格 verdict 驱动三路转移；
- Memory V2 可作为增强检索，但不能成为唯一的角色交接渠道；
- 第一版不新增独立证据实体、run document、跨运行证据引用或专用查看器。

证据准入测试：attacker 可见所有 defender 项、judge 可见双方项、截断顺序稳定、resume 可重建同等上下文。

对抗成本控制（应与 Phase 2、3 同批放量）：

- 规范化时为 `mode=adversarial` 的状态写入默认 `maxSelfTransitions: 2`，标准状态维持 3；用户显式调高时界面给出轮次与预估成本提示；
- 实现自循环重试轮的降级编排：识别“由自身转移而来”的重入，跳过 attacker，只执行 defender 修复与 judge 复核，并把上一轮 attacker 发现与 judge 裁决注入两者；
- 重试轮 judge 的复核范围包含“修改是否引入未经攻击审查的新变更”，判定为是时输出 `fail`；该判定以首轮 attacker 审查过的范围为基准累计计算，覆盖全部重试轮；
- 从上游转移进入的对抗状态仍执行完整三角色，降级只作用于自循环重入；
- 熔断出口按模式分岔：对抗状态触发熔断时进入人工审批节点并携带各轮证据，不复用“查找第一个非自身转移目标并强制转向”的路径，也不跳过 `requireHumanApproval`；标准状态维持现有行为。

主要入口：

- `src/lib/state-machine/workflow-manager.ts`
- `src/lib/run/state-persistence.ts`

### Phase 5：验证与发布

角色隔离和终态豁免的单元测试属于 Phase 0 的准入门槛，本阶段不重复，只覆盖端到端行为。

- 单元测试：字段规范化、`confidence` 与 `mode` 约束、模式推断、终态排除、来源 hash、锁定、2 状态大纲；
- 组件测试：开关、diff、用户修改步骤保留、保留步骤 `task` 改写提示、托管收口步骤新增、Agent 配置复用、单状态和批量重评估；
- 集成测试：标准内联裁决、对抗状态执行、三个角色实例会话隔离、证据上下文传递、终态汇总和三路转移；
- 回归测试：旧配置加载不变、保存后迁移、Supervisor 不进入步骤；
- 灰度指标：AI 模式覆盖率、用户覆写率、对抗状态失败率、平均 Token/耗时变化。

### Phase 6：全局意愿与复用运行级方案（最新版实现完成，自动化验证通过）

实现状态（2026-08-05）：6A～6E 已迁移到以 `origin/dev=bd7ddd8d` 为基线的 `codex/state-level-adversarial-review-v2`。最新版 lightweight 产品、AI 引导会话和 phase 移除均已保留；旧 `/workflow` 与 `lightweight/full` 预算没有恢复。创建三入口、状态级 schema/reconciler、运行级 plan/snapshot、启动两步确认、设计页锁定保护和自动生成路由已完成集成。集成收口还加入了候选级原子“交还 AI”、旧会话显式意愿门禁、AI 失败后的全目标人工选择、根/子工作流全图 preflight，以及计划快照损坏时失败关闭。完整 TypeScript 检查、全仓 ESLint 和全量 Vitest 已通过；登录后的真实模型与浏览器交互仍需人工冒烟后再对外放量。

本阶段基于现有 `reviewPolicy`、`reconcileReviewPolicy()`、运行快照和启动上下文继续开发，不重新实现状态级协议。

**6A. 共享类型与规划器**

- 新增 `WorkflowAdversarialIntent`、`RunReviewPlan`、运行级 suggestion/override 类型和校验；
- 新增服务器侧运行规划器：识别 lightweight/普通 state-machine，收集根/子工作流整体任务或非终态、计算 config/context hash、执行 disabled 本地协调或 on-demand 批量评估、调用既有 reconciler/轻量派生器、汇总 diff 与 Agent 检查；
- 运行级批量评估与 10.1 推迟的“设计页批量重评估”严格分开：前者只生成不可变 run snapshot，不保存/整体替换 workflow，安全边界更小，属于本阶段必做；
- AI suggestion 只接受窄补丁，服务端丢弃管理字段并按 `{configFile, stateId}` 定位；大配置按 `configFile` 分组，不逐状态调用。

建议新增/修改：

- `src/lib/workflow/run-review-plan.ts`（新增）
- `src/lib/workflow/state-review-policy.ts`
- `src/lib/core/api.ts`
- `src/lib/core/schemas.ts`

**6B. 新建工作流全局意愿**

- 在直接 lightweight、直接 state-machine 和 ai-guided 创建流程中增加同一份二选一协议；
- 将 `creationAdversarialIntent` 注入共享创建提示构建器；
- `disabled` 下 lightweight 固定无对抗，普通 state-machine 在本地装配层硬强制所有非终态 standard；
- `on-demand` 下 AI 引导同次返回产品类型和整体风险；lightweight 只有无需对抗时才可保存，state-machine 复用状态大纲初判和逐状态确认；
- 草案从 lightweight 切换为需要对抗时触发 state-machine 重新规划和二次确认；
- 补三种创建入口、两种意愿、两种最终产品和矛盾输出局部修复的测试。

主要入口：

- `src/components/NewConfigModal.tsx`
- `src/components/WorkflowModeSelector.tsx`
- `src/lib/ai/workflow-creation-items.ts`
- `src/lib/ai/workflow-creation-review-protocol.ts`

**6C. 复用启动两步确认**

- 扩展 `WorkflowStartContexts` 周边的启动请求类型，但把 `adversarialIntent/startPlanId/stateReviewOverrides` 放在启动请求顶层，不混入可持久化的上下文字段；
- 将 `ContextWorkspaceDialog` 改成“设置本次运行 → 确认本次运行方案”两步，保留现有所有上下文输入；
- disabled 禁用状态开关；on-demand 对普通状态机显示逐状态建议，对 lightweight 显示“保持轻量 / 本次派生状态机”的整体建议；派生后再显示有效模式、运行级用户锁、diff、Agent/成本检查；
- 用户返回第一步修改上下文或意愿时，使旧 plan 失效并重新规划；取消时不产生任何持久化变更。

主要入口：

- `src/client/pages/workbench/WorkbenchClient.tsx`
- `src/lib/workflow/start-context-store.ts`（明确不持久化意愿）

**6D. 启动 API、快照与恢复**

- 新增 `POST /api/workflow/start/plan` 和有 TTL 的服务器侧临时 plan 存储；
- 扩展 `/api/workflow/start`：校验 `startPlanId`、配置/上下文 hash 和用户 overrides，再创建 run；旧调用方字段缺失时走兼容的原配置语义；
- 扩展 `createWorkflowConfigSnapshot()` 接收根配置和子工作流的内容 overrides/transform，把有效配置写入 run snapshot，不写原 YAML；
- 增加 lightweight 运行级派生器：需要对抗时移除轻量 profile/专用字段，确定性生成“执行与对抗 → 完成”的合法普通状态机快照；无需对抗时保留 lightweight 固定拓扑；
- 最终 preflight 必须针对根配置和全部子工作流的有效 snapshot 执行，并记录命令所属 `configFile/cwd`；失败时不启动 manager；
- `PersistedRunState` 增加 `runReviewPlan`，并同步更新 `compactStateForYaml()`、`buildRunSnapshotFromState()` 及加载兼容；resume/retry/forceJump 沿用同一 snapshot 和 plan；
- rehearsal 转正式运行前重验 hash，子工作流全树应用全局意愿。
- 已计划 run 的 snapshot manifest 缺失、损坏或无法读取时失败关闭，不从当前 YAML 自动重建。

主要入口：

- `src/server/api-routes/workflow/start/plan/route.ts`（新增）
- `src/server/api-routes/workflow/start/route.ts`
- `src/lib/workflow/subworkflow-config.ts`
- `src/lib/run/state-persistence.ts`
- `src/lib/state-machine/workflow-manager.ts`（优先只验证/消费 plan，不复制协调逻辑）

**6E. 准入测试**

- 单元：disabled 零 AI 调用、全树 standard、用户修改步骤保留、on-demand 窄补丁、lightweight 整体建议与派生、低置信度升级、复合状态键、锁优先级；
- API：plan TTL/hash stale、客户端管理字段丢弃、旧调用兼容、取消无副作用、AI 失败人工兜底、preflight 覆盖根/子有效快照；
- 集成：原配置含 adversarial 时以 disabled 启动，本 run 不执行 attacker/judge 且原 YAML 字节不变；lightweight on-demand 在需要对抗时只派生 run snapshot；所有用户覆盖只影响该 run；
- 恢复：原配置在启动后被修改，resume 仍按旧 run snapshot 执行；
- 子工作流：根和嵌套配置都遵守同一全局意愿；
- UI：三种新建入口均在 AI 调用前询问，旧创建会话不补默认意愿；复用入口位于“启动工作流”的启动上下文弹窗，页面不出现“模板副本/复用副本”措辞。

Phase 6 准入门槛：上述测试通过，浏览器人工确认“原配置未修改”后，才允许对外宣称已有工作流支持运行级全局意愿。

### 10.2 分期依据与放量顺序

分期顺序由以下硬依赖决定，不能调整：

1. **实例隔离必须先于创建链路。** 对抗三角色天然串行，而串行步骤此前不使用 `agentInstanceId`，三步会落到同一个 Agent 名字并复用同一会话。若 Phase 2、3 先于该改动上线，期间产出的对抗工作流虽然带“对抗”徽标，实际是同一会话内的自问自答，与验收标准 15“无法隔离时明确阻塞而不伪装成三个身份”直接冲突。
2. **终态 verdict 豁免的两半必须同时上线。** 创建链路停止给终态汇总步骤标记 judge 与运行时停止强制裁决 JSON 是同一件事的两面。只改其一，新建工作流会在终态因缺少裁决 JSON 被判为失败并阻塞。
3. **证据交接必须与实例隔离同时上线。** 切换为三个独立 session 后，普通 `buildStepContext` 不会自动注入前序步骤输出，Memory V2 也可能禁用。没有 Phase 4 的显式上下文，attacker/judge 只是隔离了会话，并没有实现可验证的对抗审查。

放量顺序：

- Phase 0、Phase 1 对用户不可见，可先行合入；
- Phase 2 与 Phase 3 建议同批放量。只放 Phase 2 时，AI 会自动生成对抗状态，但用户在设计页看不到徽标、理由和开关，只能通过直接编辑配置移除，体验不可接受；
- Phase 4 的对抗成本控制部分（自循环上限、重试轮降级、熔断出口分岔）应与 Phase 2、3 同批放量。对抗状态从 Phase 2 起才可能存在，此前这三项没有作用对象；一旦对抗状态可被创建和运行，缺少这三项会同时带来成本失控和“失败到上限后被自动放行”两个问题；
- Phase 4 的证据交接部分是 Phase 2/3 对外放量的硬门槛，可与 Phase 0/1 并行实现，但不得后置到对抗创建能力上线之后。
- Phase 6 依赖 Phase 0～3 的状态级 schema、reconciler、UI 协议和运行实例隔离，以及现有 run snapshot 读取能力。实施顺序固定为 6A → 6B/6C（可并行）→ 6D → 6E；不得先让 UI 提交意愿，再由 start route 直接改写原 YAML。

## 11. 验收标准

1. AI 引导可以生成合法 lightweight：固定 1 个 initial/final 状态、1 个 Agent 步骤、0 个转移，并包含内部强制的 `aceharness-tasklist`。
2. AI 引导可以生成只有“执行 → 完成”的合法 2 状态普通 state-machine，且不会为了凑 3 个状态制造没有独立流转意义的状态。
3. 普通 state-machine 的每个非终态都有显式模式、来源、理由、风险信号和置信度；终态和 lightweight 固定状态不包含 `reviewPolicy`。
4. 对抗状态始终包含不同运行实例的 defender、attacker、judge，且执行顺序、会话隔离和证据可见性正确。
5. 标准状态没有系统自动创建的 attacker 或默认独立 judge，最后一个串行执行/验证步骤内联输出 verdict；并行结尾时有明确串行收口步骤。
6. 用户切换模式前能看到完整 diff；取消后配置不变；用户修改过或来源不明的对抗步骤不会被自动删除。
7. 用户锁定的状态不会被单状态优化或批量 AI 重评估覆盖，且该保证由补丁应用层强制执行。
8. “交还 AI 判断”后，AI 可以重新计算模式和编排。
9. 旧配置无需立即改写即可运行，首次保存后生成稳定的显式字段。
10. 直接 lightweight、直接 state-machine 和 ai-guided 三个创建入口共享相同的全局意愿、安全判断和本地结构门禁；最终 YAML 只可能是合法 lightweight 或普通 state-machine。
11. lightweight 候选检测到对抗需求时不会静默改为 standard，也不会生成非法多步骤轻量结构；系统改为 state-machine 重新规划并要求用户再次确认。
12. `planningDepth: compact | detailed` 若存在，只影响上下文和 Spec 追踪深度，不影响最终产品类型或对抗安全阈值。
13. 终态汇总步骤不标记为 judge、不输出 verdict，孤立终态汇总步骤不会导致旧工作流被误判为对抗模式。
14. AI 引导新建时的产品类型、整体风险和状态机大纲在同一次首轮调用返回；只有最终 state-machine 才进入逐状态步骤调用，不增加额外按状态评估调用。
15. 只有一个可执行 Agent 配置时，系统仍可通过三个隔离运行实例执行对抗状态；无法隔离时明确阻塞而不伪装成三个身份。
16. 第一版的证据交接只组装现有步骤输出为运行时上下文，不创建独立证据实体或 run document。
17. 关闭对抗模式不会改写用户创建或修改过的步骤；当保留步骤不可改写且独立 judge 被删除时，自动新增 review-policy 托管收口步骤，变换后始终存在唯一的 verdict 输出者。
18. 保存后的配置中不存在 `confidence=low` 且 `mode=standard` 的组合；该组合在规范化阶段被改写为 `adversarial`，且不触发草案重新生成。
19. 终态汇总步骤不输出裁决 JSON 时，运行不被判定为失败或阻塞；既有终态带 `role: judge` 的旧配置仍可正常执行。
20. 第一版不提供状态重命名入口，`transitions[].to` 继续以状态名引用目标状态且不被破坏。
21. 对抗状态默认 `maxSelfTransitions: 2`，标准状态默认 3；用户调高对抗状态上限时能看到轮次与预估成本提示。
22. 对抗状态自循环重入时不执行 attacker，只执行 defender 修复与 judge 复核，且上一轮 attacker 发现可在两者输入中被检出；从上游进入时仍执行完整三角色。连续两个重试轮的“新变更”判定以首轮 attacker 审查范围为基准累计计算。
23. 对抗状态触发熔断时进入人工审批并携带各轮 defender、attacker、judge 证据，不会被自动转向下游状态；标准状态的熔断行为保持不变。
24. 三种新建入口都要求用户选择全局意愿；凡是会调用 AI 的路径，都在第一次 AI 调用前完成选择。disabled 下 lightweight 保持无对抗，普通 state-machine 全部非终态为 standard 且没有 attacker/独立 judge。
25. 新建时选择 on-demand 后，lightweight 先经过整体风险门禁；普通 state-machine 保留状态级 AI 建议、逐状态覆盖和锁定能力。
26. 复用已有工作流从工作台“启动工作流”进入，复用原配置并补充本次运行上下文，不创建工作流副本。
27. 复用时选择 disabled 不产生 AI 模式评估调用；即使原配置包含 adversarial，本次 run 也不执行 attacker/judge，原 YAML 在运行前后保持字节不变。
28. 复用时选择 on-demand 使用一次运行级批量规划（必要时仅按 config 分组），用户可在确认页逐状态覆盖并锁定；覆盖只影响本次 run。
29. 全局意愿对根工作流和全部可达子工作流生效，终态始终不参与；同名状态不会因跨配置键冲突而互相覆盖。
30. 启动、恢复和重试读取同一份 `RunReviewPlan` 和有效配置快照；启动后修改原配置不改变已在运行的 run。
31. 最终 preflight 针对已应用全局意愿和逐状态覆盖的有效快照执行；过期、配置变化或上下文变化的 start plan 会被拒绝并要求重新预览。
32. on-demand AI 失败不会静默降级 standard；用户可以重试或手工完成本次选择。无法隔离角色实例时在启动前阻塞。
33. 旧 API 调用方缺失意愿字段时保持原行为；新版 UI 始终只显示 disabled/on-demand 两项，且默认不记忆上一次运行选择。
34. 复用 lightweight 时，disabled 和无需对抗的 on-demand 保持原轻量快照；需要对抗的 on-demand 只派生本次 run 的普通状态机快照，原 YAML 字节不变且不创建可复用副本。

## 12. 面向评审者的展示方式

推荐使用三层展示，顺序从“为什么改”到“用户实际得到什么”：

1. **创建三入口与两种产物图**：直接 lightweight、直接 state-machine 和 ai-guided 都先经过全局意愿；ai-guided 再推荐最终 lightweight/state-machine，明确它不是第三种持久化类型。
2. **同一需求的分流样例**：低风险清晰任务展示任务清单驱动的 lightweight；复杂或需要对抗的任务展示 2 个或更多状态的 state-machine，以及某个状态的 defender → attacker → judge 编排。
3. **复用启动时序**：打开已有工作流 → 启动工作流 → 补充本次上下文 → 选择全局意愿 → 确认本次有效方案 → 新 run，明确标注“原配置不变、没有副本”。
4. **交互效果**：演示 on-demand 下用户切换单个状态、查看 AI 理由和 diff、锁定本次选择；再切换到 disabled，展示状态级开关被全局约束禁用。

评审时不要从 YAML 字段开始讲。先让观众看到：状态数量不再机械固定、对抗成本只花在高风险状态、用户可以理解并控制 AI 的判断；然后用“同一工作流多次 run、每次上下文和全局意愿可不同”解释复用，最后再展示配置字段、运行快照和实施范围。不要再使用“模板副本”“复用副本”作为本需求的展示模型。

## 13. 待决问题

以下问题不阻塞 Phase 0 和 Phase 1 开工，但需要在对应阶段实现前给出结论。

2026-08-05 已按最新版 lightweight 产品边界补充定稿：复用不创建副本、意愿属于 run、disabled 零 AI 调用、普通 state-machine 的 on-demand 采用运行级批量窄补丁、lightweight 的 on-demand 采用整体建议并在需要对抗时派生普通状态机 run snapshot、原配置不回写、全子工作流生效、最终 preflight 针对有效快照执行。实现中的字段命名和临时 plan 存储位置可以按仓库惯例调整，但不得改变这些语义。

**生成成本（Phase 2 前必须定）**

1. 新增 `reviewPolicy`、`riskSignals`、`confidence` 的结构校验会提高 state-machine 草案局部重试概率。lightweight 不生成逐状态 policy；首轮返回的产品类型/整体风险矛盾时只修复当前规划 item。state-machine 的 policy 字段格式错误同样只局部补正当前 outline/state item，不重跑完整“1+N”草案。

**发布与度量（Phase 5 前必须定）**

2. 验收标准 2 描述的是模型行为，无法直接自动化。需要替换为可判定形式（例如固定样例集下状态数不超过 3 的比例），或明确标记为人工评审项。
3. 灰度指标四项的采集通道是否已存在；不存在时需在 Phase 5 之外单列埋点工作量。另需注意：评估节省幅度时不得以“所有状态均开启对抗”作为基线，该基线在实际使用中不存在，会显著高估收益；应使用真实历史工作流配置在新旧规则下各生成一次做对照。

**措辞（可随时处理）**

4. 决策 1 提到的任务级 L1/L2/L3 在当前代码中没有对应实现，需确认是取代既有设计方案的措辞，还是存在待移除的存量实现。

以下问题已在正文中定稿，不再列为待决：attacker 与 defender 的失败/超时处理和 `joinPolicy` 约束（7.2）、对抗状态重试与熔断成本（7.6）、`locked` 的受保护切片范围与“交还 AI 判断”的同步语义（8.3）、attacker 对抗性的强制注入来源（7.2）、旧配置对抗结构的识别判据（9）、`concurrency.agentInstances` 的登记要求与队伍名展示（7.3）。
13. `attacker → blue`、`defender → red` 与安全行业通行的红队攻蓝队守相反，但与仓库既有实现一致。语义保持不变，界面建议同时展示队伍名与角色名，避免误读。
