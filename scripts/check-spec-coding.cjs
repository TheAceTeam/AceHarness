#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  extractResultTag,
  parseCommonArgs,
  printCommonHelp,
  runCheckSuite,
} = require('./check-wrapper-runner.cjs');

const MAX_RETRIES = 5;
const KIND = 'spec_requirement';

const SYSTEM_PROMPT = `你是 CSIHarness SpecCoding 分步创建向导。系统每轮只要求一个小点。

当前小点 kind=${KIND}，名称 R1。

输出格式：
<result>
{"kind":"${KIND}","data":{"id":"R1","title":"需求标题","userStory":"作为某类用户，我希望达成某个目标，以便获得价值。","acceptanceCriteria":["WHEN 条件 THEN 结果。"]}}
</result>

<result> 内只能放一个裸 JSON 对象。`;

function buildUserPrompt() {
  return `请为“在线文档协作编辑器”生成 R1 核心需求小点。

背景：
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
  if (data.id !== 'R1') errors.push('data.id 必须是 R1');
  if (typeof data.title !== 'string' || !data.title.trim()) errors.push('data.title 缺失');
  if (typeof data.userStory !== 'string' || data.userStory.length < 12) errors.push('data.userStory 太短或缺失');
  if (!Array.isArray(data.acceptanceCriteria) || data.acceptanceCriteria.length === 0) errors.push('data.acceptanceCriteria 不能为空');
  return { valid: errors.length === 0, errors };
}

function printSummary(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`=== check:spec-coding (${summary.engine}/${summary.driver}, ${summary.model}) ===\n`);
  for (const run of summary.runs) {
    console.log(`Run ${run.run}/${summary.total}: ${run.ok ? 'PASS' : 'FAIL'} (${(run.durationMs / 1000).toFixed(1)}s)`);
    if (run.ok) {
      const outPath = path.join(__dirname, '.spec-coding-result.json');
      fs.writeFileSync(outPath, JSON.stringify(run.parsed, null, 2));
      console.log(`  saved: ${outPath}`);
    }
    if (!run.ok && run.error) console.log(`  error: ${run.error}`);
  }
  console.log(`\nPass rate: ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(0)}%)`);
}

async function main() {
  const options = parseCommonArgs(process.argv.slice(2));
  if (options.help) {
    printCommonHelp('check:spec-coding');
    return;
  }
  const summary = await runCheckSuite({
    agent: 'aceharness-spec-coding',
    step: 'spec-requirement',
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
