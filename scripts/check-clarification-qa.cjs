#!/usr/bin/env node

const {
  extractResultTag,
  parseCommonArgs,
  printCommonHelp,
  runCheckSuite,
} = require('./check-wrapper-runner.cjs');

const MAX_RETRIES = 5;
const KIND = 'workflow_clarification_question';

const SYSTEM_PROMPT = `你是 CSIHarness 分步创建向导。系统每轮只要求一个小点。

当前小点 kind=${KIND}，名称 target_outcome。

输出格式：
<result>
{"kind":"${KIND}","data":{"id":"target_outcome","label":"目标结果","question":"具体问题，并说明答案影响什么决策。","selectionMode":"single","options":[{"id":"recommended","label":"推荐选项","description":"说明影响","recommended":true},{"id":"alternative","label":"备选选项","description":"说明取舍"}],"placeholder":"跳过时采用的默认假设。","required":true}}
</result>

<result> 内只能放一个裸 JSON 对象。`;

function buildUserPrompt() {
  return `请为“在线文档协作编辑器工作流”生成目标结果澄清问题。

已知事实：
- 多人实时协同编辑
- 文档版本历史和回滚
- 权限管理
- Markdown 和富文本双模式`;
}

function validate(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return { valid: false, errors: ['结果必须是对象'] };
  if (result.kind !== KIND) errors.push(`kind 必须是 ${KIND}`);
  const data = result.data || {};
  if (data.id !== 'target_outcome') errors.push('data.id 必须是 target_outcome');
  if (typeof data.question !== 'string' || data.question.trim().length < 8) errors.push('data.question 太短或缺失');
  if (!Array.isArray(data.options) || data.options.length < 2) errors.push('data.options 至少需要 2 个选项');
  if (Array.isArray(data.options) && !data.options.some((item) => item && item.recommended === true)) errors.push('至少一个 option 需要 recommended=true');
  return { valid: errors.length === 0, errors };
}

function printSummary(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`=== check:clarification-qa (${summary.engine}/${summary.driver}, ${summary.model}) ===\n`);
  for (const run of summary.runs) {
    console.log(`Run ${run.run}/${summary.total}: ${run.ok ? 'PASS' : 'FAIL'} (${(run.durationMs / 1000).toFixed(1)}s)`);
    if (!run.ok && run.error) console.log(`  error: ${run.error}`);
  }
  console.log(`\nPass rate: ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(0)}%)`);
}

async function main() {
  const options = parseCommonArgs(process.argv.slice(2));
  if (options.help) {
    printCommonHelp('check:clarification-qa');
    return;
  }
  const summary = await runCheckSuite({
    agent: 'aceharness-spec-coding',
    step: 'workflow-clarification-question',
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
