---
name: aceharness-gitcode-ci-delivery
description: Safely trigger and verify GitCode PR CI from ACEHarness workflows.
descriptionZH: 安全触发并核验 GitCode PR CI，防止错误评论命令被误当作门禁触发。
tags:
  - ACEHarness
  - GitCode
  - CI
  - Delivery
source: aceharness
---

# ACEHarness GitCode CI 交付

GitCode 的机器人构建触发使用严格的评论协议，而不是可自由改写的命令。

## 唯一允许的构建触发评论

评论正文必须且只能是：

```
start build
```

以下写法全部无效，禁止发送：`start_build`、`start-build`、`Start Build`，以及在指令前后添加说明文字的变体。

## 执行条件

1. 仅当当前步骤任务、当前运行的人类审批，或用户的明确指令授权触发 CI 时才发送该评论。仅仅“准备 PR”或“建议触发 CI”不构成授权。
2. 先确认待推送提交和 PR head 一致；不要拿旧提交或未提交工作区结果触发门禁。
3. 发送后查询 PR/门禁记录，确认目标提交的 CI 已创建。若未创建，报告真实状态和下一步，不得将“评论已发送”写成“CI 已触发”。
4. 门禁失败必须先归因，再决定是否触发：代码缺陷回到修复/验证；疑似一次性环境波动只可按下述规则重试一次；外部依赖或原因未知升级人工。不要重复发送构建评论来掩盖失败。

## waiting-start-build 恢复流转

这个状态不是“再发一次试试”。先读取 PR 的当前 head、标签、评论原文、机器人回复、失败日志，以及该 head 已失败/已重试次数。先输出可复核的 `failureKind`：`suspected_transient`、`code_defect`、`external_dependency` 或 `unknown`；不得只因等待时间长或某次失败而声称“随机”。

1. 有 `CI-running` 或机器人已回复流水线启动：进入监控，不发送评论。
2. 对 `suspected_transient`：仅当 `waiting-start-build`、没有 `CI-running`、当前步骤或人工审批明确授权、同一 head 尚未重试过时，才可对**当前 head 仅重试一次**。第二次在同一 head 复现时，它不再是“随机失败”，必须附日志升级人工判断环境、依赖或隐藏代码原因。
3. 对 `code_defect`：不得对旧 head 重跑。必须先在本地修复、运行相关验证、以 `git commit --amend` 更新现有 PR 提交、`git push --force-with-lease` 推送并回读新 PR head。只有修复后的新 head 已验证且获得触发授权，才可精确触发一次。
4. 对 `external_dependency` 或 `unknown`：不得自动重试。收集当前 head、失败日志和依赖证据，转人工明确决定。
5. 协议错误是单独例外：有 `waiting-start-build` 且最新评论原文是 `start build\n` 等“去除空白后正确但原文不正确”的变体时，可按同样的一次上限发送裸字符串 `start build`。
6. 每次重试必须用 API/CLI 的正文参数发送裸字符串 `start build`，不要经富文本编辑器、文件或换行拼接；在 `.aceharness-evidence/gitcode-ci-retry.json` 记录 `headSha`、失败归因/证据、原始评论、发出时间、`failureCountForHead` 和 `retryCount: 1`。
7. 触发时必须记录 `botReadyEventId`、`botReadyAt`、`triggerCommentId`、`triggerAt`、headSha 和是否已出现 `CI-running`。如果精确 `start build` 发送在机器人针对当前 head 的“请回复 start build”事件**之前**，该评论未被机器人消费，不能占用该 bot-ready 事件的一次触发额度；在有授权且尚未于该 bot-ready 事件后发送过时，可自动补发一次。此补发不是“随机失败重试”，但同一 bot-ready 事件后仍无 `CI-running` 就必须报告 `external_blocked`，不要再发第二次。
8. 发出后读取 PR 标签和机器人评论。出现 `CI-running` 或“流水线已启动”即转为 `wait_external` 并监控；超过约两分钟仍无确认则报告 `external_blocked`。不要用“评论已发送”代替 CI 已创建。

因此，重试依据是“当前 head 的可证明、一次性环境波动或可纠正的协议错误”，不是根据等待时长盲目刷评论。

## ACEHarness 运行时保护

ACEHarness 会检查已观测到的 GitCode PR 评论命令。发现 `start_build` 或 `start-build` 时会取消该 Agent 回合，并将步骤标记为失败恢复。该保护是最后防线；仍应在执行前遵守本 Skill。

## PR 提交形态：默认单提交

已创建 PR 后，后续的 codecheck、CI 或评审反馈修复属于同一评审单元，默认必须保持 **一个 PR、一个提交**：

1. 先读取 PR head、本地 `HEAD`、目标分支和工作区状态。远端 head 与本地不一致时先停止，不能盲目改写历史。
2. 仅暂存本轮已验证的文件，运行必要验证后使用 `git commit --amend` 更新 PR 的现有提交；没有用户明确授权时，不得再创建第二个普通 commit。
3. amend 后只能用 `git push --force-with-lease` 推送同一源分支；禁止裸 `--force` 与 `--no-verify`。
4. 推送后回读 PR head，并验证 `merge-base(base, HEAD)..HEAD` 的提交数为 1。若远端出现并发更新、无法安全 amend，或仓库明确要求提交序列，保留证据并请求用户决定，不能自行改为多提交。
5. 仅首次创建 PR 前允许普通 `git commit`；用户明确要求保留分步历史时，按其要求执行并在 PR 描述说明提交序列。

## 联合 PR：测试仓是交付成员，不是后续事项

若修复需要独立测试仓（例如 `cangjie_test`）的回归用例，则主仓与测试仓必须关联同一 Issue，组成联合 PR 交付：

1. 用户启动时只提供 Issue 来源；在开始修复前由 Agent 根据 Issue、主仓 Profile、同类修复与测试归属自动发现主仓、测试仓、目标分支和是否必须补回归用例，并写入**内部** `jointPrContract`。不得要求用户提供测试仓地址；只有自动发现出现真实歧义时才请求最小澄清。解析后写入 `gateContract.requiredPrs`。
2. 必需测试仓用例必须创建或更新对应测试仓 PR；不得在主仓 PR 中把它表述为普通 follow-up，也不得仅靠评论承诺替代。
3. 触发和观察门禁时按 `requiredPrs` 逐仓确认。任一必需 PR 未推送、门禁失败、存在未解决检视意见、未满足审批或未合入，联合交付都不能判为完成。
4. 只有用户明确豁免测试仓 PR，并同时记录理由、风险、替代验证与可追踪后续项时，才允许例外；该豁免必须进入 Gate 契约和 PR 描述。

## 仓颉测试仓的提交与验证规范

当内部联合交付契约要求 `cangjie_test`（或其他独立测试仓）时，在“根因与修复”阶段完成以下工作，而不是等到评审阶段补救：

1. 自动定位测试仓，读取仓库 `.gitcode` 模板、测试目录和现有相邻用例；只暂存本轮测试文件。测试仓已有 PR 时以 `git commit --amend` 更新该 PR 的单一提交，并以 `git push --force-with-lease` 推送；新建测试仓 PR 时再创建首个普通提交。测试仓 PR 必须关联与主仓相同的 Issue，并互相在描述中引用。
2. 用例按失败机制最小化：写清版权头、触发条件、`DEPENDENCE`、`EXEC`/`ERRCHECK` 和 `ASSERT`/`SCAN`（或仓库等价断言）。依赖在 `DEPENDENCE` 可带相对路径，但执行命令使用 basename；纯语义/诊断用例优先 staticlib 或 CHIR dump 检查，避免链接失败造成假 PASS。
3. 在“验证”阶段先发现真实测试框架入口、`CANGJIE_HOME` 及目标产物，再按主机与产物选择匹配 cfg；macOS 需要链接时先检查 `SDKROOT`。优先运行带 `--verbose` 的完整框架，并保存实际命令与 `SCAN`/`ASSERT` 结果。
4. 只有框架或交叉环境确实不可用时才可做定向 compile-only；报告必须标为“非完整端到端验证”，不得据此宣称测试仓 PR 已通过。完整框架 PASS 才是测试仓交付的验证结论。
