# Task 2: DSH_HOME 与环境变量适配

Progress: 100%
Status: Done

## Goal

通过 OpenMA 文档化变量复用 dsh Web 的配置、凭据、插件、模型目录和 session 持久化。

## Completed

- OpenMA standalone 支持 `DSH_PATH`、`DSH_PROVIDER`、`DSH_MODEL`、`DSH_PERMISSION_MODE`、`DSH_SESSION_ROOT`，并从 DSH_HOME 读取凭据和设置。
- ACPX 会话将 `DSH_HOME`、provider/model、权限、session root 和 DeepSeek key/base URL 转发给 OpenMA ACP。
- provider/model 在 ACPX 选择与 DSH 启动环境间正确拆分，已保留 provider-qualified 模型 ID。
- 运行期不执行依赖安装或 profile provisioning。

## Acceptance

- 已有 dsh Web 设置和 credentials 可被 ACP 进程直接读取。
- 环境变量设置页与 runtime schema 使用同一组变量和 allowlist。
- 运行期间不创建、删除或重建 DSH profile。

## Verification Record

- OpenMA README/package metadata audit: Pass。
- `npx vitest run tests/api-engine-availability.test.ts tests/api-models-route.test.ts tests/runtime-adapters.test.ts`: Pass，84 tests。
- `npx tsc --noEmit --pretty false`: Pass。
- `git diff --check`: Pass。
