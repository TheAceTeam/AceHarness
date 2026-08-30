# Task 3: ACPX 会话、模型与事件兼容

Progress: 100%
Status: Done

## Goal

验证 OpenMA ACP 与 ACEHarness 的会话、模型、事件、工具、权限和恢复语义完全对接。

## Completed

- ACEHarness adapter 已有通用 ACPX 事件归一化和会话持久句柄逻辑。
- OpenMA standalone 已通过 initialize、session/new、session/list、session/load 和 session/prompt；模型、权限模式、配置项、流式文本/思考/工具、usage、title、取消均有协议探针证据。
- ACEHarness focused mock suite 覆盖 provider/model qualified id、session resume fallback、cancel、permission、事件归一化、模型选择和聊天/工作流适配。
- ACPX runtime 使用兼容 session store 后，本地 OpenAI-compatible fixture 已返回 `text_delta` 与 `end_turn`，请求模型为裸模型名并由 `DSH_PROVIDER` 传递 provider。

## Acceptance

- ACPX 不再等待 gateway loopback 或出现 startup timeout。
- 文本、思考、工具、usage、plan、title、error 和 cancel 事件均可归一化。
- 模型列表包含 DSH_HOME 中配置的 provider/model。

## Verification Record

- OpenMA standalone initialize/new/list/load probe: Pass。
- OpenMA local SSE prompt probe: Pass，返回 `agent_message_chunk`、`usage_update` 和 `stopReason=end_turn`。
- ACPX runtime local SSE fixture: Pass，返回 `text_delta`、`stopReason=end_turn`，provider/model 路由正确。
- `npx vitest run` DeepSeek/ACPX focused suite: Pass，16 files / 136 tests。
- `npx tsc --noEmit --pretty false`: Pass。
- `git diff --check`: Pass。
