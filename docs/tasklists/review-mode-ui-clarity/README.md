# 状态审查模式界面易用性改造

Updated: 2026-08-13
基线分支: `dev` @ `c716bdd6`
建议工作分支: `fix/review-mode-ui-clarity`

进度：**全部完成**。Phase 1、1B、2 已实施并通过验证（含回归测试）；原 Phase 3 经评估后放弃，理由见文末。

## 0. 背景

rc.11 用户反馈，工作流设计面板的「状态审查模式」区域有三处让人困惑：

1. 「标准」「对抗」两个词太抽象，看不出区别是什么。
2. 锁的标识让人担心自己的操作权被限制。
3. 「交还 AI 判断」这个说法很怪。

经代码核查，**第 2 点不是误解，是实际存在的功能缺陷**：锁一旦生效会禁用用户自己的「删除状态」按钮，且界面上没有解锁入口，而按钮提示却指向一个不存在的「解除锁定」操作。第 1、3 点是文案问题。

随后又收到第二批反馈两点——失败态红框只框住一半、启动时对抗选择无默认值且位置太靠下，见 Phase 1B。其中第二点同样不止是易用性问题，而是主按钮被一个屏幕外的条件静默锁死。

---

## 1. 必读：这个功能到底在配什么

执行本任务前必须理解下面这段，否则会改错方向。

工作流被切成若干「状态」（阶段）。一个状态的活干完后，需要有人判定"合格吗"，据此决定进入下一状态还是打回重做。**「状态审查模式」配置的就是这个判定由谁来做**，只有两个取值：

- **standard（标准）**——干活的人自己判。该状态最后一个串行步骤在交付成果的同时，在同一次输出末尾附上状态裁决 JSON（`pass` / `conditional_pass` / `fail`）。
- **adversarial（对抗）**——另派两个角色来判。系统自动插入两个托管步骤：`对抗审查`（attacker，职责是主动寻找反例、边界、遗漏和错误假设，明确禁止复述 defender 结论）和 `独立裁决`（judge，看完双方证据后独立下判决）。三类角色绑定互相隔离的 agent 实例，防止串通。

成本差异：对抗模式在既有步骤后追加两个托管步骤，即 n → n+2——单步状态是 3 倍，四步状态只有 1.5 倍，**不存在固定倍数**；且该状态的自循环上限从 3 降到 2（见 `defaultMaxSelfTransitions`，`src/lib/workflow/state-review-policy.ts:305`），因为每轮重试要跑完三个角色。

**用户真正在做的决定是"要不要额外花两个 Agent 的成本来挑错"**，而「标准/对抗」这两个词描述的是内部编排的形状。这是第 1 点困惑的根因。

---

## 2. 设计锁（Design Locks，不得违反）

### 2.1 `locked` 字段的真实语义

`reviewPolicy.locked` 的设计意图是「**AI 优化时不得改动这个策略**」，它保护的是用户，不是限制用户。证据：

- `src/lib/workflow/design-ai-optimization.ts:543` —— `if (baseState.reviewPolicy?.locked && !target.unlockForAi) return null;`，AI 的 patch 碰到 locked 状态直接拒绝。
- 同文件 `:323` —— AI patch 若丢弃了 locked 状态则整体作废。
- 同文件 `:298`、`:555` —— AI 自己产出的 policy 永远是 `locked: false`。

**因此：任何"锁"相关的 UI 都不得禁用用户自己的编辑操作。锁只约束 AI。**

### 2.2 关键约束：`source: 'user'` 会强制 `locked: true`

`src/lib/workflow/state-review-policy.ts:250`：

```ts
locked: source === 'user' ? true : Boolean(base.locked),
```

`normalizeReviewPolicy` 在三条路径上都会跑：`creator-validation.ts:207`（保存校验）、`workflow-manager.ts:244`（运行时装载）、`run-review-plan.ts:259`（启动计划）。

**推论（极其重要）**：只要 `source === 'user'`，任何把 `locked` 置为 `false` 的 UI 操作都会在下一次归一化时被悄悄改回 `true`。所以：

- ❌ **不要**新增一个只写 `locked: false` 的「解锁」按钮——它看起来生效了，保存后就失效，比没有更糟。
- ❌ **不要**在 Phase 1 里试图解耦 `source` 和 `locked`——那要改 `:250` 这行核心逻辑，会波及 `inferBaselineAdversarialIntent`（`:856-868`，启动对话框据此推断基线意图）和 `tests/state-review-policy.test.ts:19` 的测试夹具。这件事最终被评估后放弃，见文末「已放弃」一节。

Phase 1 的解法是：**保留自动上锁的行为，但让锁不再限制用户**，并把现成的「AI 重新评估模式」按钮作为唯一的、语义正确的松绑出口（它走 `unlockForAi` 路径，是合法解锁）。

### 2.3 不得改动的东西

- 不要改 `src/lib/workflow/state-review-policy.ts` 的任何判定逻辑（Phase 1、2 全程只读该文件）。
- 不要改 `reconcileReviewPolicy` 产出的编排结果。
- 托管审查步骤（`provenance.origin === 'review-policy'`）的编辑/拖拽/删除**禁用是合理的**，只改提示语，不改 `disabled` 条件。
- 不要动 `forceAdversarial` 的判定逻辑（`:245`），Phase 2 只增加它的可见性。

---

## 3. 阶段划分

| 阶段 | 内容 | 风险 | 状态 |
|---|---|---|---|
| Phase 1 | 解除对用户的误伤 + 锁/AI 相关文案 | 低，纯 UI，单文件 | **已完成** |
| Phase 1B | 失败态红框裁剪 + 启动对话框默认值与位置 | 低到中 | **已完成** |
| Phase 2 | 选项说明 + 后果预览 + 隐藏覆盖告知 + 术语行折叠 | 中 | **已完成（T8 方向已修正，见下）** |
| ~~Phase 3~~ | 解耦 `source` 与 `locked` | 高，改核心归一化逻辑 | **已放弃**，见文末 |

### ⚠️ T8 的方向在实施时被推翻

原计划把「标准 / 对抗」改名为「自检收口 / 独立复核」。**实施前核查发现这样做不安全，已改为另一种做法。**

原因是这两个词并非纯展示文案，它们同时是会被持久化的数据：

- `state-review-policy.ts:555` 生成的托管步骤名就叫 `对抗审查` / `独立裁决`，会写进工作流 YAML；而 `hashReviewStep` 把 `name` 计入 `baselineHash`，改名会让既有配置里所有托管步骤失去「未被修改」身份，进而破坏 `isManagedStepUnmodified` 把关的安全删除与转换逻辑（`:736`、`:756`）。
- 「对抗模式」「标准模式」还出现在系统生成、存进配置的 `rationale` 文本里，以及发给 AI 的提示词中（`workflow-creation-review-protocol.ts:243`、`:257`）。

只改按钮文案会让界面与引擎写出的数据、文档、提示词全面脱节，比原来的「抽象」更糟。

**实际做法**：保留「标准 / 对抗」作为正式名称，改为在 UI 上为每个选项配一句「谁来判 + 什么代价」的说明。这解决了原始抱怨（看不懂两个词的区别），又不动任何持久化数据。

> **教训**：动任何术语之前，先确认它是不是只存在于展示层。本项目里模式名同时是步骤名、哈希输入、AI 提示词词汇。

> ⚠️ **工作树状态提醒**：当前 `dev` 上同时存在另一条无关的工作线（人工审查横幅相关，改动集中在 `WorkbenchClient.tsx`）。本文档中 `WorkbenchClient.tsx` 的行号取自这个已被改动的工作树，随时可能再次偏移。**务必用文中给出的代码片段原文做匹配定位，不要依赖行号。**

---

## Phase 1：解除误伤（全部改动在 `src/components/StateMachineDesignPanel.tsx`）

### T1. 删除状态按钮不再因上锁而禁用 ★核心

**位置**：`src/components/StateMachineDesignPanel.tsx:744-745`（`SortableStateListItem` 内的删除按钮）

**现状**：

```jsx
        disabled={Boolean(state.reviewPolicy?.locked)}
        title={state.reviewPolicy?.locked ? '请先将审查模式交还 AI 或解除锁定' : '删除状态'}
```

**改为**：

```jsx
        title="删除状态"
```

即删掉 `disabled` 整行，`title` 简化为常量。

**理由**：删除状态是正常的设计操作，没有数据完整性上的理由阻止。删除后若有转移悬空，现有校验会照常报错（见同文件 `:498-505` 对不存在目标状态的检查），无需额外防护。原提示里承诺的「解除锁定」在界面上根本不存在。

**验收**：给某状态选定审查模式（会自动上锁）后，鼠标悬停删除按钮显示「删除状态」，点击可正常删除。

> ⚠️ **2026-08-12 补充（首轮验收发现）**：只改 JSX 不够。`handleDeleteState` 里还有第二道拦截，见 T1b。只做 T1 会得到一个「看起来能点、点了没反应」的死按钮，比原来的禁用状态更糟。

---

### T1b. 移除 `handleDeleteState` 里的重复拦截 ★阻断项

**位置**：`src/components/StateMachineDesignPanel.tsx:1474-1481`

**现状**：

```ts
  const handleDeleteState = (name: string) => {
    const target = states.find((state) => state.name === name);
    if (target?.reviewPolicy?.locked) return;
    onStatesChange(states.filter(s => s.name !== name));
```

**改为**：删掉 `if (target?.reviewPolicy?.locked) return;` 这一行；`target` 变量随之无用，一并删除。

**理由**：违反设计锁 2.1（锁只约束 AI）。与 T1 必须同时完成，否则按钮解禁但功能仍被静默拦截。

---

### T1c. 解除另外三个状态级控件的锁禁用 ★首轮遗漏

首轮文档只列出了删除按钮，实际上同一个 `reviewPolicy.locked` 还禁用了三个用户自己的编辑控件，属于同一类问题，一并处理。**均为删除 `disabled` 整行**，不改其它逻辑：

| 控件 | 位置 | 现状代码 |
|---|---|---|
| 状态名称输入框 | `:1889` | `disabled={Boolean(selectedState.reviewPolicy?.locked)}` |
| 「终止状态」复选框 | `:1909` | `disabled={Boolean(selectedState.reviewPolicy?.locked)}` |
| 最大自循环次数输入框 | `:1964` | `disabled={Boolean(selectedState.reviewPolicy?.locked)}` |

**安全性核查（均已确认无数据完整性风险）**：

- 重命名走 `renameStateAndReferences`（`:1894`），会同步更新所有引用该状态的转移，不会产生悬空引用。
- 勾选「终止状态」后，`normalizeStateMachineWorkflowConfig`（`state-review-policy.ts:380`）会自动删除该状态的 `reviewPolicy`，语义自洽。
- `maxSelfTransitions` 由用户显式设置时本就受尊重，归一化不会覆盖（见 `state-review-policy.ts:381-385` 的注释）。

**不要动**的是步骤级拦截（`:1486`、`:1494`、`:1502`、`:1518`、`:1534`、`:1541`、`:1572`、`:1585`、`:1616`、`:1421`）：它们都以 `isReviewStructureStep()` 或托管步骤 provenance 为条件，只保护系统生成的审查步骤，符合设计锁 2.3。

---

### 方法论补充（写给后续执行者）

**改任何「解除禁用」类任务时，必须同时检查 JSX 的 `disabled` 属性和其背后的 handler**。本项目的模式是两处都有拦截，只改一处会得到静默失效的控件。定位方法：

```bash
grep -n "reviewPolicy?\.locked\|reviewPolicy\.locked" src/components/StateMachineDesignPanel.tsx
```

逐条判断该拦截作用于**整个状态**（应移除）还是**系统托管的审查步骤**（应保留）。

---

### T2. 状态列表的锁图标改为图钉

**位置**：`src/components/StateMachineDesignPanel.tsx:729-731`

**现状**：

```jsx
        {!state.isFinal && state.reviewPolicy?.locked ? (
          <span className="material-symbols-outlined text-[12px] leading-none" title="用户已锁定审查模式">lock</span>
        ) : null}
```

**改为**：

```jsx
        {!state.isFinal && state.reviewPolicy?.locked ? (
          <span className="material-symbols-outlined text-[12px] leading-none" title="已固定：AI 优化时不会改动这个状态的审查模式，你自己仍可随时调整">push_pin</span>
        ) : null}
```

**理由**：挂锁图标在通用产品语汇里表示"你被挡在外面"，与该标记的实际含义（AI 别动）正好相反。图钉表示"钉住不动"，语义正确且不含权限暗示。

---

### T3. 卡片上的「用户锁定」徽章改为「已固定」

**位置**：`src/components/StateMachineDesignPanel.tsx:2091-2093`

**现状**：

```jsx
                    {selectedState.reviewPolicy.locked ? (
                      <Badge variant="outline" className="gap-1 text-[10px]"><span className="material-symbols-outlined text-[12px]">lock</span>用户锁定</Badge>
                    ) : null}
```

**改为**：

```jsx
                    {selectedState.reviewPolicy.locked ? (
                      <Badge variant="outline" className="gap-1 text-[10px]" title="AI 优化时不会改动这个模式；你自己仍可随时切换">
                        <span className="material-symbols-outlined text-[12px]">push_pin</span>已固定
                      </Badge>
                    ) : null}
```

---

### T4. 统一「让 AI 重新评估」文案 ★

> 📌 **后续变更**：这个名字在收尾阶段又改了一次，最终为「**AI 重新评估模式**」，并补上说明边界的 tooltip；同时标题栏的「AI 优化」统一为「AI 优化状态」。以代码为准，本节保留当时的记录。

**位置**：`src/components/StateMachineDesignPanel.tsx:2126-2130`

**现状**：

```jsx
                  {onOptimizeState ? (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={returnReviewPolicyToAi}>
                      {selectedState.reviewPolicy.locked ? '交还 AI 判断' : 'AI 重新评估'}
                    </Button>
                  ) : null}
```

**改为**：

```jsx
                  {onOptimizeState ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      title="AI 只提供建议，你确认后才会生效"
                      onClick={returnReviewPolicyToAi}
                    >
                      让 AI 重新评估
                    </Button>
                  ) : null}
```

**理由**：该按钮实际调用 `returnReviewPolicyToAi`（同文件 `:1353-1361`），只请 AI 重新评估这一个状态的 `reviewPolicy` 并返回建议，随后走 diff 确认弹窗，**用户确认才生效**。"交还"暗示决定权本属于 AI，与实际行为不符。注意更好的文案原本就存在于未锁定分支，此处只是统一。

---

### T5. 「锁定当前模式」改为「固定此模式」

**位置**：`src/components/StateMachineDesignPanel.tsx:2121-2125`

**现状**：

```jsx
                  {!selectedState.reviewPolicy.locked ? (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={lockCurrentReviewPolicy}>
                      锁定当前模式
                    </Button>
                  ) : null}
```

**改为**：

```jsx
                  {!selectedState.reviewPolicy.locked ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      title="固定后，AI 优化不会改动这个模式；你自己仍可随时切换"
                      onClick={lockCurrentReviewPolicy}
                    >
                      固定此模式
                    </Button>
                  ) : null}
```

---

### T6. 确认弹窗说明改写

**位置**：`src/components/StateMachineDesignPanel.tsx:2402-2406`

**现状**：

```jsx
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                状态「{reviewPolicyCandidate.stateName}」将切换为
                <span className="mx-1 font-semibold">{reviewPolicyCandidate.targetMode === 'adversarial' ? '对抗模式' : '标准模式'}</span>
                ，确认后该选择会标记为用户来源并锁定。
              </div>
```

**改为**：

```jsx
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                状态「{reviewPolicyCandidate.stateName}」将切换为
                <span className="mx-1 font-semibold">{reviewPolicyCandidate.targetMode === 'adversarial' ? '对抗模式' : '标准模式'}</span>
                。确认后这个选择会被固定，AI 优化时不会改动它；你自己仍可随时切换模式或删除该状态。
              </div>
```

**理由**：「标记为用户来源并锁定」是内部字段术语（`source` / `locked`），对用户无意义，且"锁定"正是引发担忧的词。

---

### T7. 托管步骤禁用提示语改写

**位置**：`src/components/StateMachineDesignPanel.tsx` 的 `SortableStepRow`，共 **7 处** tooltip（第 562、623、628、633、638、642、645 行）

**只改字符串常量，不改 `disabled` 条件。** 两个字面量全量替换（用 replace-all，勿逐行手改）：

| 现有字面量 | 出现次数与行号 | 改为 |
|---|---|---|
| `'当前审查结构已锁定'` | **5 处**：562, 623, 628, 633, 645 | `'系统维护的审查步骤，切换审查模式即可调整'` |
| `'审查角色步骤由本地编排维护'` | 2 处：638, 642 | `'系统维护的审查步骤，内容由审查模式决定'` |

⚠️ 注意第 **562** 行是拖动手柄，条件是 `dragLocked` 而非 `structureLocked`，容易在只扫按钮时漏掉。替换后请用 `grep -c "当前审查结构已锁定"` 确认结果为 `0`。

**理由**：这两处禁用本身是正确的（托管步骤由 `reconcileReviewPolicy` 生成维护，手改会破坏编排契约），问题只在于用"锁定"一词，强化了"用户被限制"的观感。新文案说明原因并指出出路。

---

### Phase 1 验收

代码检查：

```bash
npm run lint
npx tsc --noEmit
npx vitest run tests/state-machine-design.test.ts tests/state-review-policy.test.ts tests/design-ai-optimization.test.ts
npx vitest run tests/components --environment jsdom
```

预期：全部通过。Phase 1 不触碰任何被测逻辑，若有测试失败说明改错了文件。

**回归测试**：`tests/components/StateMachineDesignPanel.review-lock.test.tsx`（2026-08-12 新增）钉住了三件事——固定模式的状态可被真正删除（断言 `onStatesChange` 确实被调用，而不只是按钮未禁用）、名称/终止标记/自循环次数三个控件可编辑、图标与文案已换新。

该测试已通过"回退修复即失败"验证：把 `handleDeleteState` 里的拦截加回去，它会以 `expected "vi.fn()" to be called 1 times, but got 0 times` 失败。这正是首轮验收漏掉的死按钮症状，现在由自动化覆盖。

人工验证（`npm run dev`，打开工作流设计面板）：

**这一节必须真正在浏览器里点一遍，不能只看代码。** 首轮验收失败正是因为跳过了第 3 步的实际点击——按钮外观和文案都对，但点下去没有任何反应。

1. 选中一个非终态状态 → 点「对抗」→ 确认。
2. 左侧列表该状态出现**图钉**图标（不是挂锁），悬停显示"已固定…"。
3. 该状态的**删除按钮可用**，悬停显示「删除状态」，**点击后该状态确实从列表中消失**。← 本次改造的核心验收点
4. 状态名称、「终止状态」勾选框、最大自循环次数三个控件**均可编辑**（T1c）。
4. 卡片上徽章显示「已固定」，右侧按钮显示「AI 重新评估模式」（Phase 1 当时为「让 AI 重新评估」，后续已改名）。
5. 悬停被禁用的托管步骤操作按钮，提示不含"锁定"字样。

---

## Phase 1B：第二批用户反馈

来源：rc.11 用户追加反馈两点——失败时的红框只框住一半；启动时对抗选择没有默认值、且位置太靠下不易发现。

两项分属不同文件、互不依赖，可分别提交。

---

### T12. 失败/运行态的 ring 被滚动容器裁剪

**位置**：`src/components/workflow/RuntimeStateStructurePanel.tsx:261`

**现象**：某个执行步骤失败时，卡片的红色边框只显示一部分（通常上边缺失；如果失败的是第一张或最后一张卡，对应的左/右边也缺失），看起来像「只框住一半」。

**根因**（CSS 规范行为，不是写错了 class）：

失败态的红框是画在卡片上的 `ring-2 ring-red-500/35`（`:280`），Tailwind 的 `ring` 用 box-shadow 实现，绘制在元素**边框盒之外**。而父容器是：

```jsx
            <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
```

CSS Overflow 规范规定：`overflow-x` 与 `overflow-y` 其中一个不是 `visible` 时，另一个的 `visible` 会计算成 `auto`。所以这个容器**在垂直方向同样会裁剪**，尽管代码里只声明了 `overflow-x-auto`。

容器只有 `pb-2`（下 8px），上／左／右都没有内边距；卡片又是 `items-stretch` 撑满高度，顶边紧贴容器内容边缘 → 顶部那 2px 的 ring 落在padding 盒之外，被裁掉。下边因为有 8px padding 所以完整显示。

**改为**：

```jsx
            <div className="-mx-1 flex items-stretch gap-3 overflow-x-auto px-1 pb-3 pt-1">
```

`pt-1` 给顶部 ring 留 4px；`px-1` 与 `-mx-1` 相抵，横向净位移为零，不破坏与上方标题的对齐；`pb-3` 同时容纳 ring 与横向滚动条。顶部会下移 4px，视觉可忽略；若需像素级对齐再补 `-mt-1`。

**同时修好了运行态**：`:279` 的 `ring-2 ring-blue-500/35` 有完全相同的缺陷，只是蓝色不扎眼没人反馈，本次一并解决，无需额外改动。

**备选一行改法**：把两处 `ring-2` 改成 `ring-2 ring-inset`，让 ring 画在盒内，永不被裁。代价是外发光变成内描边，观感略变。**优先采用上面的 padding 方案**，它保留原设计意图。

**验收**：构造一个失败步骤（或临时把 `resolveStepStatus` 的返回值改成 `'failed'` 目视确认后改回），红框四条边完整闭合；分别检查第一张、中间、最后一张卡。

---

### T13. 启动对话框：对抗选择无默认值，且主按钮被隐形条件锁死 ★

**位置**：`src/client/pages/workbench/WorkbenchClient.tsx`，`ContextWorkspaceDialog` 内

**现象与根因**：这不只是「没有默认选项」。真正的问题是——

`「下一步：确认本次运行方案」`按钮的 disabled 条件里含 `!adversarialIntent`：

```jsx
              <Button onClick={() => void createRunReviewPlan()} disabled={props.actionDisabled || taskInputInvalid || !adversarialIntent || reviewPlanningBusy}>
```

而对抗选择那一节是整个滚动区的**最后一节**（排在本次任务、工作目录、全局上下文、状态上下文、项目检查命令之后）。于是用户看到的是：**底部主按钮点不动，而导致它点不动的选择在屏幕外，界面上没有任何提示说明原因。** 这与 Phase 1 修掉的删除按钮属于同一类缺陷。

结构上还有个错位：**对话框里其他字段全部标注「选填」，唯一必填的决策却排在最后。**

---

#### T13a. 给默认值（**两处都要改**）

`inferBaselineAdversarialIntent` 对没有状态级策略的配置（轻量工作流、协议之前的老配置）返回 `null`，这类工作流打开就是无选中状态。两处都要补默认值，漏改任何一处，对话框重开后仍会回到无选中：

| 位置 | 现状 |
|---|---|
| `useState` 初值 | `props.runReviewPlanning?.baselineIntent ?? null,` |
| 重置 effect | `setAdversarialIntent(props.runReviewPlanning?.baselineIntent ?? null);` |

**均把 `?? null` 改为 `?? 'disabled'`。**

**为什么默认「不开启对抗」而不是「按需开启」**：`baselineIntent` 为 `null` 的正是轻量与协议前的老工作流。`disabled` 的语义是「零次 AI 评估；轻量保持原样」，等于维持这些工作流一直以来的行为。默认成 `on-demand` 会给每次运行悄悄增加一次 AI 规划开销、甚至为轻量任务派生状态机——属于用户没有要求的行为变更。**保守默认是对的，用户随时可以改。**

注意 `useState` 的类型标注 `WorkflowAdversarialIntent | null` 保留不动：`props.runReviewPlanning` 不存在时该状态仍无意义，且 `reviewSelection()` 与 `createRunReviewPlan()` 里的空值判断是有效兜底。

#### T13b. 把这一节前移

把 `本次运行是否允许使用对抗流程？` 整个 `<section>` 移到「本次任务」之后（或直接置顶）。理由：它是全对话框唯一的**必填**决策，排在一堆选填项之后是反的。

移动时注意各 `<section>` 的分隔线 class 不一致（`border-t` / `border-b` / 无边框），换位后需相应调整，避免出现双线或断线。

#### T13c. 让禁用状态说明理由

补上默认值后，按钮理论上不会再被这个条件卡住。但作为兜底，当 `!adversarialIntent` 时在按钮附近显示一句「请先选择本次是否使用对抗流程」，不要让用户对着无声的灰按钮猜。

**验收**：用一个**轻量或协议前的老工作流**（`baselineIntent` 为 `null` 的那类）打开启动对话框——这是唯一能复现的场景，用新配置测不出问题：

1. 打开即有选中项，且为「不开启对抗」。
2. 「下一步：确认本次运行方案」立即可点，无需先滚到底部。
3. 对抗选择出现在首屏，无需滚动。
4. 关闭对话框重开，默认值仍在（验证 T13a 的第二处）。

**建议补测试**：这两点又是"自动化测试看不见、只有真人点才发现"的类型。至少为 T13a 补一个单元测试，断言 `baselineIntent` 为 `null` 时 `adversarialIntent` 初值为 `'disabled'`。

---

## Phase 2：改名与告知（需确认后执行）

> 以下 Phase 2 各条为实施前的原始计划，保留以便追溯。**T8 已按上文说明改变做法**，其余按原计划完成。

### T8. 模式改名为结果导向（⚠️ 已废弃，见上文）

把描述内部编排的「标准/对抗」换成说明"谁来判"的措辞，并把成本写在旁边：

- `标准` → **自检收口**，副标题"最后一步自己给结论 · 快、省"
- `对抗` → **独立复核**，副标题"另派 2 个 Agent 挑错并裁决 · 更可靠、约 3 倍开销"

涉及位置：

- `StateMachineDesignPanel.tsx:2089` 模式徽章
- `StateMachineDesignPanel.tsx:2101-2120` 两个切换按钮（同时把选中态从 `disabled` 改为分段控件样式——现在选中项靠禁用实现，看起来像"不可用"）
- `StateMachineDesignPanel.tsx:726` 状态列表圆点的 title
- `StateMachineDesignPanel.tsx:2404` 确认弹窗内的模式名

**跨界面一致性**（不同步改会出现两套词并存）：

- `src/client/pages/workbench/WorkbenchClient.tsx:1918-1922` —— 启动对话框的「基线：对抗」「配置锁」「已锁定」三个徽章；另见 `:1844` 的工作流级「已锁定」徽章与 `:1975` 的「恢复配置锁定 / 恢复 AI 建议」按钮
- `src/components/workflow/RuntimeStateStructurePanel.tsx:42-44`（`modeLabel`）与 `:94-97`（步骤角色标签）
- `src/lib/workflow/run-review-plan.ts:585` —— 警告文案"配置中锁定的对抗模式已被本次运行的全局意愿覆盖为标准模式。"

**必然打破的测试**：`tests/components/RuntimeStateStructurePanel.test.tsx:57-58` 钉死了 `执行与对抗：对抗模式`、`标准验收：标准模式` 两个 aria-label，改 `RuntimeStateStructurePanel.tsx` 就必须同步更新该测试。

### T9. 切换前显示后果摘要

在切换按钮附近（`StateMachineDesignPanel.tsx:2100-2131` 区域）显示一行预览，例如"切到独立复核将新增 2 个步骤，自我重试上限 3 次 → 2 次"。

数据现成，无需新增计算：`reconcileReviewPolicy` 返回的 `operations` 已含全部增删改；重试上限取自 `defaultMaxSelfTransitions`（`state-review-policy.ts:305`）。

### T10. 置信度低被强制转对抗，必须显式告知 ★

`state-review-policy.ts:245` 的 `forceAdversarial`：当 `confidence === 'low'` 且用户选了 `standard` 时，系统会把它改成 `adversarial`，目前唯一痕迹是往 `rationale` 末尾追加一句话。

用户实际经历是"我点了标准，确认后显示对抗"，会被当成 bug。需在确认弹窗（`:2407-2411` 的 warnings 区域附近）用独立的醒目警告条说明。

**只加展示，不改 `state-review-policy.ts` 的判定逻辑。**

### T11. 来源/置信度行折叠

`StateMachineDesignPanel.tsx:2095-2098` 的「来源：… · 置信度：…」对新手是纯术语，折叠进 info 图标，主位置让给一句大白话（如"这个状态怎么验收：最后一步自己给结论"）。

---

## 已放弃：解耦 `source` 与 `locked`

**曾考虑**：用户选一次模式就自动固定（`source: 'user'` 在 `state-review-policy.ts:250` 强制 `locked: true`），且界面没有手动取消固定的按钮。是否应当解耦？

**决定：不做。** Phase 1 完成后这件事已无实际危害——

固定标记原本会禁用删除状态、状态名称、终止勾选和自循环次数，那才是真问题，Phase 1 已全部解除。现在它只剩一个作用：AI 优化时不改动用户选定的模式，也就是它本来的设计意图。想让 AI 重判，卡片上就有「AI 重新评估模式」按钮（唯一会临时解除固定的入口）。

剩下的只是「图钉自动出现、没有手动摘除按钮」这个语义问题，没有功能影响。而要改它就得动 `:250` 这行核心归一化逻辑，连带影响 `inferBaselineAdversarialIntent` 对启动对话框基线意图的推断、`design-ai-optimization.ts` 中六处依赖 `locked` 的保护逻辑，以及 `tests/state-review-policy.test.ts:19` 的夹具。为纯语义收益冒这个风险不划算。

> 如果将来真要重开这个议题，先确认一件事：解耦之后，用户选定的模式还能不能可靠地挡住 AI 优化。那是 `locked` 存在的唯一理由。

---

## 不在范围内

- 不改 `reconcileReviewPolicy` 的编排产出。
- 不改对抗模式的角色职责、agent 实例隔离规则、自循环上限默认值。
- 不改 `forceAdversarial` 的触发条件（只增加它的可见性）。
- 不改工作流启动流程的运行时覆盖逻辑（`run-review-plan.ts`），Phase 2 只碰其中一句警告文案。
- 不新增「取消固定」按钮（理由见文末「已放弃」一节）。

---

## 附：关键代码位置速查

| 内容 | 位置 |
|---|---|
| 审查策略核心逻辑 | `src/lib/workflow/state-review-policy.ts` |
| `source: 'user'` 强制上锁 | 同上 `:250` |
| 置信度低强制转对抗 | 同上 `:245` |
| 自循环上限默认值 | 同上 `:305` |
| AI 优化的锁保护 | `src/lib/workflow/design-ai-optimization.ts:543` |
| 设计面板（主战场） | `src/components/StateMachineDesignPanel.tsx` |
| 状态列表项 | 同上 `:657-751` |
| 审查模式卡片 | 同上 `:2077-2145` |
| 模式切换确认弹窗 | 同上 `:2389-2430` |
| 切换模式的入口函数 | 同上 `:1215`（`requestReviewModeChange`） |
| 请 AI 重评的入口函数 | 同上 `:1353`（`returnReviewPolicyToAi`） |
| 上锁的入口函数 | 同上 `:1363`（`lockCurrentReviewPolicy`） |
| 启动对话框同类措辞 | `src/client/pages/workbench/WorkbenchClient.tsx:1918-1922` |
| 运行时结构面板措辞 | `src/components/workflow/RuntimeStateStructurePanel.tsx:42-44` |
| 步骤卡滚动容器（T12） | `src/components/workflow/RuntimeStateStructurePanel.tsx:261` |
| 步骤卡 ring 样式（T12） | 同上 `:279-280` |
| 启动对话框组件（T13） | `WorkbenchClient.tsx` 的 `ContextWorkspaceDialog` |
| 对抗意图默认值（T13a） | 同上 `:1595`、`:1646`（两处，均需改） |
| 对抗选择区块（T13b） | 同上 `:2174` 起的 `<section>` |
| 被锁死的主按钮（T13c） | 同上 `:2212` |

> 行号基于 `dev` @ `c716bdd6` 之上的工作树。`StateMachineDesignPanel.tsx` 的行号已含 Phase 1 改动；`WorkbenchClient.tsx` 的行号取自一个含无关改动的脏工作树，**极易偏移**。执行前一律用文中给出的**代码片段原文**做匹配定位，不要依赖行号。
