#!/usr/bin/env node

const {
  extractResultTag,
  parseCommonArgs,
  printCommonHelp,
  runCheckSuite,
} = require('./check-wrapper-runner.cjs');

const MAX_RETRIES = 5;
const KIND = 'workflow_state_outline';

const SYSTEM_PROMPT = `你是 CSIHarness Workflow Creator 分步创建向导。系统每轮只要求一个小点。

当前小点 kind=${KIND}，名称 state_outline。

输出格式：
<result>
{"kind":"${KIND}","data":{"states":[{"name":"需求确认","description":"确认范围和验收口径"},{"name":"开发实现","description":"完成实现和审查"},{"name":"测试验证","description":"验证结果"},{"name":"完成","description":"汇总交付","isFinal":true}]}}
</result>

状态按顺序串行推进；并发只在同一状态的 steps 内表达。<result> 内只能放一个裸 JSON 对象。`;

function buildUserPrompt() {
  return `请为在线文档协作编辑器创建 workflow 状态轮廓：

1. 需求确认阶段
2. 开发实现阶段
3. 测试验证阶段
4. 完成状态`;
}

function validate(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return { valid: false, errors: ['结果必须是对象'] };
  if (result.kind !== KIND) errors.push(`kind 必须是 ${KIND}`);
  const states = result.data?.states;
  if (!Array.isArray(states) || states.length < 2) {
    errors.push('data.states 至少需要 2 个状态');
    return { valid: false, errors };
  }
  if (!states.some((state) => state && state.isFinal === true)) errors.push('至少一个状态需要 isFinal=true');
  for (const [index, state] of states.entries()) {
    if (!state?.name) errors.push(`states[${index}].name 缺失`);
  }
  return { valid: errors.length === 0, errors };
}

function printSummary(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`=== check:workflow-creator (${summary.engine}/${summary.driver}, ${summary.model}) ===\n`);
  for (const run of summary.runs) {
    console.log(`Run ${run.run}/${summary.total}: ${run.ok ? 'PASS' : 'FAIL'} (${(run.durationMs / 1000).toFixed(1)}s)`);
    if (run.ok) console.log(`  states: ${(run.parsed.data?.states || []).map((s) => s.name).join(' -> ')}`);
    if (!run.ok && run.error) console.log(`  error: ${run.error}`);
  }
  console.log(`\nPass rate: ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(0)}%)`);
}

async function main() {
  const options = parseCommonArgs(process.argv.slice(2));
  if (options.help) {
    printCommonHelp('check:workflow-creator');
    return;
  }
  const summary = await runCheckSuite({
    agent: 'aceharness-workflow-creator',
    step: 'workflow-state-outline',
    systemPrompt: SYSTEM_PROMPT,
    maxRetries: MAX_RETRIES,
    createInitialMessages: () => [{ role: 'user', content: buildUserPrompt() }],
    extractResult: extractResultTag,
    validate,
    buildExecutionErrorPrompt: (error) => `上一轮执行失败：${error}\n请重新输出 kind=${KIND} 的当前小点。`,
    buildRepairPrompt: ({ error }) => `上一轮结果不合规：${error}\n请只补发 kind=${KIND} 的 <result> JSON。`,
  }, options);
  printSummary(summary, options);
  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
