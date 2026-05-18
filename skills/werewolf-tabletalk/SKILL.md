---
name: werewolf-tabletalk
description: Use when the user wants AI to play Chinese-style Werewolf, host a Werewolf table, simulate roles such as seer/werewolf/witch/hunter/guard/villager, or produce structured police-badge, police-off, day-speech, voting, and identity-claim statements. Enforces concise tabletop rules, role constraints, and fixed speaking formats instead of vague freeform chatter.
---

# Werewolf Tabletalk

Use this skill whenever the task is to make AI act like a Werewolf player or host in a Chinese-style狼人杀桌游, especially for:

- 警上竞选发言
- 警下站边、归票、PK 发言
- 预言家 / 悍跳狼发言
- 女巫 / 猎人 / 守卫 / 村民 / 狼人桌面表达
- 夜间决策说明
- 主持人总结、推进流程、结算发言

This skill is for **桌游表达与博弈约束**. It is not for writing generic fiction dialogue.

## First step

When this skill is active, first align on three things before speaking:

- 本局板子和胜利条件
- 自己当前身份和这一轮目标
- 当前是警上、警下、夜间行动、遗言、PK、投票还是主持总结

Do not start with vague filler talk.

## Default assumptions

Unless the user gives different rules, assume a common Chinese Werewolf flow:

- 黑夜行动 -> 天亮 -> 警长竞选（如有） -> 白天发言 -> 放逐投票 -> 遗言 / 技能结算 -> 下一夜
- 常见身份：预言家、女巫、猎人、守卫、白痴、村民、狼人
- 胜负目标：
  - 好人放逐全部狼人
  - 狼人屠边或按板子规则获胜

If the board is explicitly given, obey the board and do not invent absent roles.

## Glossary

### 1. 上警环节

- `警长竞选`：第一天白天竞选警长，票最多者拿警徽，通常有 1.5 票、可定发言顺序、且警长末置位发言
- `上警`：参与警长竞选
- `警上`：参与了警长竞选的玩家
- `警下`：没有参与警长竞选的玩家
- `退水 / 放手`：退出警长竞选
- `不退水 / 刚着`：不退出警长竞选
- `反水立警`：被发金水的玩家反过来跳预言家争警徽
- `警徽流`：预言家提前留下后续验人顺序
- `飞警徽`：警长出局后把警徽传给信任玩家
- `吞警徽`：狼人通过自爆等方式让警徽体系失效
- `撕警徽`：通过放逐警长或作废警徽来破坏警徽体系
- `上票`：投票
- `拉票`：争取别人给自己上票
- `弃票 / 压票 / 压手`：不投票
- `前置位`：同轮中先发言的位置
- `后置位`：同轮中后发言的位置
- `末置位 / 归票位`：同轮最后发言、适合归票的位置

### 2. 发言与行为

- `屠城`：神职和平民全部出局则狼人胜
- `屠边`：平民全出局或神职全出局则狼人胜
- `跳身份 / 拍身份`：公开说明自己的身份
- `金水`：预言家查出的好人
- `银水`：女巫解药救下的人
- `铜水`：守卫守住的人
- `废水 / 验尸`：预言家查验到但当夜倒牌的人
- `金银双水`：既是金水又被女巫救过的人
- `查杀`：预言家查出的狼人
- `悍跳`：狼人冒认神职，最常见是悍跳预言家
- `表水`：通过发言减轻自己嫌疑
- `双金水`：真假预言家都给好人定义
- `双查杀`：真假预言家都打狼人定义
- `接金水 / 喝金水`：相信给自己发金水的预言家
- `端金水`：暂时不完全认给自己金水的预言家
- `反水 / 倒金水`：被发金水却反对这个预言家
- `心路历程`：为什么验这个人
- `顺验`：按顺序验人
- `单边预`：只有一个人跳预言家
- `站边`：相信谁是真预言家
- `站错边`：信了悍跳狼
- `站对边`：信了真预言家
- `倒牌`：出局
- `自爆`：狼人承认自己是狼，直接进入黑夜
- `刀人`：狼人夜里杀人
- `遗言`：出局后的发言
- `过麦`：发言结束，轮到下一个人
- `归票`：号召大家一起投某人
- `拉PK / 上PK台`：把两张牌放到对比位
- `票出局 / 推出局`：白天被公投放逐
- `票型`：每个人把票投给了谁
- `首验`：预言家第一夜查验的人
- `开枪`：猎人或黑狼王出局时发动技能带人
- `空守`：守卫不守任何人
- `撒毒 / 泼毒`：女巫使用毒药
- `可乐`：女巫毒药的口语说法
- `预言家面`：一个人像不像预言家
- `盘逻辑`：用逻辑推动站边或归票
- `抿状态`：通过情绪、状态、节奏看身份
- `头铁`：站错边也不回头
- `划水`：发言少、发言空、没信息量
- `开枪状态`：猎人或黑狼王当前能否开枪
- `首刀`：第一夜被狼人击杀的人
- `自刀`：狼人刀自己队友
- `空刀`：狼人夜里不刀人
- `墙头草`：反复换立场
- `做好`：发言更像好人
- `做坏 / 不做好`：发言更像狼人
- `续刀 / 连刀`：连续两夜盯同一目标
- `指刀 / 点刀`：指定夜里刀谁
- `场外`：用游戏外信息判断身份
- `失联 / 挂机`：玩家不进行操作
- `黑麦 / 断麦 / 卡麦`：发言中断或听不清
- `贴脸`：不讲逻辑，靠发誓、威胁、情绪证明自己
- `带走`：用技能让别人出局

## Hard rules

- 发言必须像桌游发言，不能空聊感受，不能泛泛说“我再看看”“我先听听”然后没有结论。
- 每段发言必须至少包含：
  - 当前站边或态度
  - 对 1 到 3 张牌的身份判断
  - 下一步重点听谁 / 归票到谁 / 票型怎么看
- 不要乱跳身份。
- 神牌不要过早半拍身份，不要说“我是神”这种容易送刀的废话。
- 平民不要乱穿神衣，不要靠“我是平民”证明自己，更自然的表达是“我是一张好人牌”。
- 女巫没开解药时，默认隐藏身份。
- 出局或被抗推出局、且局势允许时，应尽量报清身份，减少好人思考量，并避免狼人穿衣服。

## Role priorities

### 预言家

Core job:

- 报验人
- 给站边理由
- 留警徽流
- 定义警上警下格局

Do not only say "我是真预言家". Must explain:

- 验了谁
- 为什么验
- 金水/查杀如何影响归票
- 第一警徽流、第二警徽流

### 悍跳狼

Core job:

- 抢预言家位
- 报假金水/查杀
- 留假警徽流
- 扰乱好人站边

警上狼人不是去说场面话的。 If a wolf goes police-on, it should seriously consider whether to:

- 悍跳预言家
- 强起好人面抢警徽
- 退水做身份

Do not force one fixed wolf distribution. Consider:

- 警上人数
- 警下投票空间
- 悍跳收益
- 狼坑暴露风险
- 做身份空间

### 女巫

Core job:

- 谨慎用药
- 保护信息位
- 白天不要乱暴露药型

Default medicine style:

- 不机械首夜开解药
- 优先考虑后续保护预言家、警长真信息位、关键神职
- 只有刀口明显高价值、自己必须自救、或这一救能明显改局时，再积极开药

### 猎人

Core job:

- 白天观察谁值得带
- 不轻易暴露
- 被放逐或死亡时尽量把技能收益最大化

### 守卫

Core job:

- 守护关键位
- 注意守护节奏
- 不要在不该跳的轮次乱跳守卫找死

### 村民 / 闭眼玩家

Core job:

- 站边
- 找划水、跟风、爆狼点
- 看票型、互踩、共边关系

No-information speech is still not empty speech. Say:

- 我现在偏站谁
- 谁发言最好 / 最差
- 哪两张可能不共边
- 这轮建议归谁

## Fixed speaking formats

Use the matching format below. Do not omit sections unless the scene truly does not have that information.

### 1. 警上预言家 / 悍跳狼

Use this structure:

1. 身份与验人结论
2. 验人心路
3. 站边 / 打对跳
4. 警徽流
5. 格局判断
6. 收口归票

Template:

```text
X号这里先起跳预言家，Y号是我的金水/查杀。
我验Y的心路历程是……
前置位A号我觉得……，如果有人跟我对跳，我现在更像把B号定义成……
第一警徽流我留……，第二警徽流我留……，理由是……
警上我觉得……，警下我觉得……，这一轮我重点听……。
目前我希望大家先站边我，今天优先看……这几张牌。
```

Requirements:

- Must mention `金水/查杀`
- Must mention `验人心路`
- Must mention `第一警徽流/第二警徽流`
- If there is a counter-claim, must explicitly hit it

### 2. 警上其他身份

Use this structure:

1. 当前是否上警、目的是什么
2. 前置位预言家面判断
3. 当前站边或暂不站死边
4. 后续重点听谁

Template:

```text
我这张X号牌上警的目的就是先找预言家/先听格局。
前置位A号跳预言家我觉得……，B号我觉得……。
我现在偏站…… / 我现在五五开，不站死边。
我重点再听……这几张牌和后置位对跳，再决定警徽票怎么投，过。
```

Requirements:

- Must say whether you currently soft-side someone
- If undecided, must say what evidence you are waiting for

### 3. 警下通用发言

Use this structure:

1. 先报当前站边
2. 点 1 到 3 张牌的身份判断
3. 说清逻辑点
4. 给出归票建议

Template:

```text
警下听完这一轮，我现在站边……。
A号我觉得……，B号我觉得……，C号我觉得……。
核心逻辑在于……，尤其是……这个点在我这里不成立 / 很成立。
这一轮我建议在……里面归，或者我更想先出……号牌。
```

Useful tabletop phrases:

- 划水
- 跟风
- 爆狼 / 聊爆了
- 不共边
- 冲锋 / 倒钩
- 带节奏
- 归票
- 撕警徽
- PK

### 4. 被点、被踩、被 PK 的回应

Use this structure:

1. 回应对方踩点
2. 说明为什么逻辑不通
3. 反点对方身份
4. 重新归票

Template:

```text
A号踩我的这个点在我这里是不通的，因为……。
如果我真是狼人，我没必要……。
反而A号这轮的发言更像……，B号跟A号的关系我也要一起看。
所以我这一轮还是建议在……里面归。
```

### 5. 女巫 / 守卫 / 猎人这种带身份牌的白天发言

原则：

- 能藏则藏
- 不轻易明跳
- 发言重点是逻辑，不是喊身份

Preferred style:

```text
我这张牌目前不想拍身份，但我能告诉你们，A号这轮发言在我这里不太成立。
尤其是……这个点，他像是开了额外视角。
今天如果归票，我会更偏向……。
```

### 6. 主持人总结

Use this structure:

1. 当前站边格局
2. 警上 / 警下关键冲突
3. 票型关注点
4. 下一步行动

Template:

```text
这一轮场上主要形成了……和……两条站边。
关键冲突集中在A、B、C三张牌。
票型上重点看……，尤其是谁在跟票、谁在冲票、谁在撕警徽。
接下来进入……，请重点听……。
```

## Night action format

When asked for a night action, use:

1. 目标
2. 收益判断
3. 风险判断
4. 最终结论

Examples:

- 预言家查验：为什么查这个人、查出金水/狼人的收益
- 女巫用药：为什么救 / 为什么不救
- 守卫守护：为什么守这个位
- 狼刀口：为什么刀这个位对第二天收益最大

## Anti-patterns

Do not do these:

- 大段空话，没有落到具体牌
- 只说“我再听听”，不给条件
- 预言家不报警徽流
- 狼人警上不抢身份只尬聊
- 闭眼玩家全程不站边
- 神牌过早半拍身份
- 平民乱跳神

## Reference

For fuller phrase banks and scene examples, read:

- `references/speech-templates.md`
