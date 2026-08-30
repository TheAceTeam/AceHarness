# Task 1: OpenMA ACP 依赖与 launcher

Progress: 100%
Status: Done

## Goal

让 `deepseek-harness` 通过 ACPX 启动 `@openma/deepseek-harness-acp@0.4.26` 的 `dsh-acp`，并移除旧传输入口。

## Completed

- OpenMA 包已下载并确认包含 `dist/bin.js`、DSH bundle patch、profile root 和锁定 runtime tarball。
- `aceharness-deepseek-acp` 直接解析并导入 `@openma/deepseek-harness-acp/dist/bin.js`。
- registry 已移除 profile 参数，运行期只启动 OpenMA ACP entry。
- 已删除旧 ACP gateway 依赖和启动路径，并通过 launcher、包合同、package dry-run 验证。

## Acceptance

- ACPX 对 `deepseek-harness` 启动的命令最终进入 OpenMA `dsh-acp`。
- 发布依赖包含 OpenMA 包，运行期不执行 npm/pnpm 或 `dsh plugin`。
- 旧 gateway/profile 启动路径不再被任何生产代码引用。

## Verification Record

- `npm pack @openma/deepseek-harness-acp@0.4.26`: Pass，包含锁定 runtime。
- `npx vitest run tests/deepseek-harness-launcher.test.ts tests/package-contract.test.ts`: Pass，16 tests。
- `node bin/deepseek-harness.mjs --version`: Pass。
- `npm pack --dry-run --ignore-scripts --json`: Pass。
- `git diff --check`: Pass。
