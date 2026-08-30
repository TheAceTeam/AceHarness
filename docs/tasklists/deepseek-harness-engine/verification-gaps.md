# Current Verification Gaps

Updated: 2026-08-30

- 真实外部 provider prompt 仍需在用户提供有效 API key 且 `127.0.0.1:7890` 可访问时复测；当前 shell 未检测到该代理监听。
- 浏览器层面的视觉回归由用户手动验收；功能层 focused tests 与本地 ACPX fixture 已通过。

## Must-Run Verification

- `npx vitest run tests/deepseek-harness-launcher.test.ts tests/agent-registry.test.ts tests/api-engine-availability.test.ts tests/api-models-route.test.ts tests/runtime-adapters.test.ts tests/model-select.test.tsx tests/components/EnvVarsDialog.test.tsx tests/package-contract.test.ts`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- `npm pack --dry-run --ignore-scripts --json`
