# Task 4: 前端入口与安装验证

Progress: 100%
Status: Done

## Goal

完成所有 DeepSeek Harness 前端入口、环境变量提示、npm 发布内容和安装级验证。

## Completed

- 引擎、模型、选择器、聊天、工作流、工作台和设置页面已有 deepseek-harness 接入。
- Engines、Models、模型选择器、Agent 编辑、聊天、工作流、工作台、个人设置和系统环境变量均通过统一 registry/route 接入 `deepseek-harness`。
- DeepSeek 环境变量作为独立设置组展示，GitCode Token 保持在工具链设置区域；引擎描述使用产品能力说明。
- 发布包包含 `aceharness-deepseek-acp` 和 OpenMA 依赖；运行期不执行 npm 或 profile provisioning。

## Acceptance

- 用户全局安装 ACEHarness 后无需运行期安装即可启动 `dsh-acp`。
- DeepSeek 变量与其他引擎设置并列展示，模型状态来自实际 ACP 能力。
- focused tests、typecheck、diff check 和 pack 检查通过。

## Verification Record

- OpenMA tarball contents audit: Pass，`@openma/deepseek-harness-acp@0.4.26` 包含 standalone `dsh-acp` 与锁定 runtime。
- `node scripts/check-engine-availability.mjs --engine deepseek-harness --json`: Pass，报告 OpenMA ACP 0.4.26 可用。
- `node scripts/check-runtime-availability.mjs --agent deepseek-harness --json`: Pass。
- `npm pack --dry-run --ignore-scripts --json`: Pass，发布内容包含 DeepSeek launcher、icon 与 runtime。
- `npm pack --ignore-scripts --pack-destination .tmp` + `npm install --prefix .tmp/aceharness-install <tarball> --ignore-scripts`: Pass，隔离安装后 bin 可执行且报告 OpenMA ACP 0.4.26。
- `npx vitest run` focused UI/runtime suite: Pass，16 files / 136 tests。
- `npx tsc --noEmit --pretty false`: Pass。
- `git diff --check`: Pass。
