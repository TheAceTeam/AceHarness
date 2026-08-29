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
4. 任何 codecheck、测试或 CI 失败都应按工作流转移返回修复/验证；不要重复发送构建评论来掩盖失败。

## waiting-start-build 恢复流转

这个状态不是“再发一次试试”。先读取 PR 的当前 head、标签和评论原文，并按以下有限状态处理：

1. 有 `CI-running` 或机器人已回复流水线启动：进入监控，不发送评论。
2. 有 `waiting-start-build`、机器人在当前 head 后明确要求 `start build`、最新评论原文是 `start build\n` 等“去除空白后正确但原文不正确”的变体：若当前步骤或人工审批明确授权，可对**当前 head 仅重试一次**。
3. 重试时必须用 API/CLI 的正文参数发送裸字符串 `start build`，不要经富文本编辑器、文件或换行拼接；在 `.aceharness-evidence/gitcode-ci-retry.json` 记录 `headSha`、原始评论、发出时间和 `retryCount: 1`。
4. 发出后读取 PR 标签和机器人评论。出现 `CI-running` 或“流水线已启动”即转为 `wait_external` 并监控；超过约两分钟仍无确认则报告 `external_blocked`，不要再发第二次。
5. 若最新评论已经字节级等于 `start build`，或当前 head 已有该重试记录，停止自动操作并升级为平台机器人未消费指令的外部依赖问题。

因此，重试依据是“当前 head 的可证明、可纠正的协议错误”，不是根据等待时长盲目刷评论。

## ACEHarness 运行时保护

ACEHarness 会检查已观测到的 GitCode PR 评论命令。发现 `start_build` 或 `start-build` 时会取消该 Agent 回合，并将步骤标记为失败恢复。该保护是最后防线；仍应在执行前遵守本 Skill。
