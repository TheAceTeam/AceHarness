#!/usr/bin/env node
/**
 * check-clarification-qa.cjs
 *
 * 通过当前仓库的 engine wrapper 真实调用 AI，检查补充问答（clarification）步骤是否能产出
 * 符合校验规则的 clarification_form JSON，并统计通过率。
 *
 * 默认:
 *   engine = opencode
 *   driver = sdk
 *   model  = glm-4.7
 */

const fs = require('fs');
const path = require('path');
const {
  extractResultTag,
  parseCommonArgs,
  printCommonHelp,
  runCheckSuite,
} = require('./check-wrapper-runner.cjs');

const MAX_RETRIES = 2;

const SYSTEM_PROMPT = `你正在帮助用户做正式计划前的需求访谈。目标不是多问问题，而是补齐会改变方案、边界、兼容、验收或任务拆分的关键信息。

⚠️ 绝对禁止：不要创建任何文件。不要输出 markdown 表格或纯文字问题列表。你的唯一输出目标是在回复末尾的 <result> 内输出一个机器可读 JSON 对象，类型为 clarification_form。

先从用户输入、工作目录和已有上下文中提炼已确认事实；不要重复询问已经给出的信息，也不要把推测写成事实。

本轮输出必须像资深产品/技术负责人做需求访谈：先给当前理解，再指出证据来源，再把缺口分为 blocking 与 optional，最后只问 3 到 7 个高价值问题。

问题必须落到具体决策：目标用户与成功结果、当前行为与目标行为、范围与非目标、输入/输出/状态、兼容/迁移、失败/边界、安全/隐私、性能/可靠性、验证/发布。

每个问题都使用结构化表单表达：声明 selectionMode=single 或 selectionMode=multiple，提供 2 到 4 个选项，至少一个选项带 recommended=true，同时保留 placeholder 供用户补充自由文本。

每个问题的题面都要说明"这个答案会影响什么决策"，避免"还需要什么功能""是否要优化体验""是否需要联调"这类无法直接落地的问题。

如果用户跳过某个问题，后续计划应采用保守默认假设；因此问题的 placeholder 或选项描述里要能看出默认假设和剩余风险。

机器可读结果放在 <result>...</result> 内，并且 <result> 内只放一个独立的 JSON 对象，不要包 \`\`\`json 代码块。

## 输出格式

<result>
{"kind":"clarification_form","payload":{"summary":"当前理解摘要","knownFacts":["已确认事实1","已确认事实2"],"missingFields":["blocking: 缺失1","optional: 缺失2"],"questions":[{"id":"question_id","label":"问题标签","question":"具体问题描述，说明答案影响什么决策","selectionMode":"single","options":[{"id":"option_1","label":"选项1","description":"选项描述","recommended":true},{"id":"option_2","label":"选项2","description":"选项描述"}],"placeholder":"跳过时的默认假设说明","required":true}]}}
</result>

## 规则

1. kind = "clarification_form"
2. payload.summary 非空字符串
3. payload.knownFacts 非空数组
4. payload.missingFields 非空数组，每项以 "blocking:" 或 "optional:" 开头
5. payload.questions 数组长度 3-7
6. 每个 question 必须有 id、label、question、selectionMode、options、placeholder
7. selectionMode 只能是 "single" 或 "multiple"
8. 每个 question 的 options 数量 2-4
9. 至少一个 option 带 recommended: true
10. 每个 option 必须有 id、label、description

## 禁止事项
- 不要在 <result> 外面输出 JSON
- 不要输出多个 <result>
- JSON 必须合法（无注释、无尾逗号）
`;

const USER_PROMPT = `请为以下项目做需求澄清访谈：

项目名称：在线文档协作编辑器
工作目录：/Users/dev/collab-editor
需求描述：
- 多人实时协同编辑（基于 CRDT）
- 文档版本历史和回滚
- 权限管理（查看/编辑/管理员）
- Markdown 和富文本双模式

请先分析已知事实和缺失信息，然后生成结构化的澄清问答表单。
输出在 <result> 标签内。`;

const extractResult = extractResultTag;

function validate(result) {
  const errors = [];
  if (!result || typeof result !== 'object') {
    return { valid: false, errors: [`结果必须是 JSON 对象，但实际类型是 ${typeof result}。确保 <result> 内是合法 JSON`] };
  }

  if (result.kind !== 'clarification_form') {
    errors.push(`kind 必须是 "clarification_form"，但实际值是 ${JSON.stringify(result.kind)}。顶层 key 有: [${Object.keys(result).join(', ')}]`);
  }
  if (!result.payload || typeof result.payload !== 'object') {
    return { valid: false, errors: [...errors, `缺少 payload 对象。顶层 key 有: [${Object.keys(result).join(', ')}]。正确结构: {"kind":"clarification_form","payload":{...}}`] };
  }

  const p = result.payload;

  if (typeof p.summary !== 'string' || !p.summary.trim()) {
    errors.push(`payload.summary 必须是非空字符串，但实际 ${p.summary === undefined ? '不存在' : `类型是 ${typeof p.summary}，值是 ${JSON.stringify(p.summary)}`}。payload 的 key 有: [${Object.keys(p).join(', ')}]`);
  }

  if (!Array.isArray(p.knownFacts) || p.knownFacts.length === 0) {
    errors.push(`payload.knownFacts 必须是非空数组，但实际 ${p.knownFacts === undefined ? '不存在' : Array.isArray(p.knownFacts) ? '是空数组 []' : `类型是 ${typeof p.knownFacts}`}。示例: ["基于 CRDT 实现协同","支持 Markdown 和富文本"]`);
  } else {
    for (let i = 0; i < p.knownFacts.length; i++) {
      const fact = p.knownFacts[i];
      if (typeof fact !== 'string' || !fact.trim()) {
        errors.push(`knownFacts[${i}] 必须是非空字符串，但实际 ${typeof fact === 'string' ? '是空字符串 ""' : `类型是 ${typeof fact}，值是 ${JSON.stringify(fact)}`}`);
      }
    }
  }

  if (!Array.isArray(p.missingFields) || p.missingFields.length === 0) {
    errors.push(`payload.missingFields 必须是非空数组，但实际 ${p.missingFields === undefined ? '不存在' : Array.isArray(p.missingFields) ? '是空数组 []' : `类型是 ${typeof p.missingFields}`}。每项必须以 "blocking:" 或 "optional:" 开头，例如 ["blocking: 并发冲突解决策略","optional: 离线编辑支持"]`);
  } else {
    const hasBlocking = p.missingFields.some((f) => /^blocking\s*[:：]/i.test(f));
    if (!hasBlocking) {
      const first3 = p.missingFields.slice(0, 3).map((f) => `"${String(f).slice(0, 60)}"`).join(', ');
      errors.push(`missingFields 中必须至少有一项以 "blocking:" 开头，但当前 ${p.missingFields.length} 项都不符合。前几项: [${first3}]。正确示例: "blocking: CRDT 库选型未确定"`);
    }
  }

  if (!Array.isArray(p.questions) || p.questions.length === 0) {
    errors.push(`payload.questions 必须是非空数组，但实际 ${p.questions === undefined ? '不存在' : Array.isArray(p.questions) ? '是空数组 []' : `类型是 ${typeof p.questions}`}`);
    return { valid: false, errors };
  }

  if (p.questions.length < 3) errors.push(`questions 数量为 ${p.questions.length}，少于最小值 3。需要 3-7 个问题`);
  if (p.questions.length > 7) errors.push(`questions 数量为 ${p.questions.length}，超过最大值 7。需要 3-7 个问题`);

  for (let i = 0; i < p.questions.length; i++) {
    const q = p.questions[i];
    const prefix = `questions[${i}]`;

    if (!q || typeof q !== 'object') {
      errors.push(`${prefix}: 必须是对象，但实际类型是 ${typeof q}`);
      continue;
    }

    const qKeys = Object.keys(q);
    const missingFields = [];
    if (typeof q.id !== 'string' || !q.id.trim()) missingFields.push('id');
    if (typeof q.label !== 'string' || !q.label.trim()) missingFields.push('label');
    if (typeof q.question !== 'string' || !q.question.trim()) missingFields.push('question');
    if (missingFields.length > 0) {
      errors.push(`${prefix}: 缺少必填字段 [${missingFields.join(', ')}]。当前有的 key: [${qKeys.join(', ')}]。每个 question 必须有 id、label、question、selectionMode、options、placeholder`);
    }

    if (q.selectionMode !== 'single' && q.selectionMode !== 'multiple') {
      errors.push(`${prefix}: selectionMode 必须是 "single" 或 "multiple"，但实际值是 ${JSON.stringify(q.selectionMode)}`);
    }

    if (!Array.isArray(q.options) || q.options.length === 0) {
      errors.push(`${prefix}: options 必须是非空数组，但实际 ${q.options === undefined ? '不存在' : Array.isArray(q.options) ? '是空数组' : `类型是 ${typeof q.options}`}`);
      continue;
    }

    if (q.options.length < 2) errors.push(`${prefix}: options 数量为 ${q.options.length}，少于最小值 2。需要 2-4 个选项`);
    if (q.options.length > 4) errors.push(`${prefix}: options 数量为 ${q.options.length}，超过最大值 4。需要 2-4 个选项`);

    let hasRecommended = false;
    for (let j = 0; j < q.options.length; j++) {
      const opt = q.options[j];
      const optPrefix = `${prefix}.options[${j}]`;

      if (!opt || typeof opt !== 'object') {
        errors.push(`${optPrefix}: 必须是对象，但实际类型是 ${typeof opt}`);
        continue;
      }

      const optMissing = [];
      if (typeof opt.id !== 'string' || !opt.id.trim()) optMissing.push('id');
      if (typeof opt.label !== 'string' || !opt.label.trim()) optMissing.push('label');
      if (typeof opt.description !== 'string' || !opt.description.trim()) optMissing.push('description');
      if (optMissing.length > 0) {
        errors.push(`${optPrefix}: 缺少必填字段 [${optMissing.join(', ')}]。当前有的 key: [${Object.keys(opt).join(', ')}]。每个 option 必须有 id、label、description`);
      }
      if (opt.recommended === true) hasRecommended = true;
    }

    if (!hasRecommended) {
      const optLabels = q.options.filter((o) => o && o.label).map((o) => `"${o.label}"`).join(', ');
      errors.push(`${prefix}: 至少一个 option 必须设置 recommended=true，但当前 ${q.options.length} 个选项 [${optLabels}] 都没有。在最推荐的选项上加 "recommended":true`);
    }

    if (typeof q.placeholder !== 'string' || !q.placeholder.trim()) {
      errors.push(`${prefix}: 缺少 placeholder 字段（类型 ${typeof q.placeholder}）。placeholder 用于说明跳过此问题时的默认假设，例如 "默认采用 Yjs 作为 CRDT 库"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function printSummary(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`=== check:clarification-qa (${summary.engine}/${summary.driver}, ${summary.model}) ===\n`);
  for (const run of summary.runs) {
    const label = run.ok ? 'PASS' : 'FAIL';
    console.log(`Run ${run.run}/${summary.total}: ${label} (${(run.durationMs / 1000).toFixed(1)}s)`);
    if (run.sessionId) console.log(`  session: ${run.sessionId}`);
    if (run.ok && run.parsed?.payload?.questions?.length != null) {
      console.log(`  questions: ${run.parsed.payload.questions.length}`);
    }
    if (!run.ok && run.error) console.log(`  error: ${run.error}`);
    if (!run.ok && run.output) console.log(`  output: ${String(run.output).replace(/\s+/g, ' ').trim().slice(0, 240)}`);
    if (!run.ok && run.validationErrors?.length) {
      for (const item of run.validationErrors) console.log(`  - ${item}`);
    }
  }
  console.log(`\nPass rate: ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(0)}%)`);
}

async function main() {
  const options = parseCommonArgs(process.argv.slice(2), {
    engine: 'opencode',
    driver: 'sdk',
    model: 'glm-4.7',
    timeoutMs: 180_000,
    runs: 1,
  });

  if (options.help) {
    printCommonHelp('check:clarification-qa', '\n示例:\n  npm run check:clarification-qa -- --engine opencode --driver sdk --model glm-4.7 --runs 3');
    process.exit(0);
  }

  const summary = await runCheckSuite({
    agent: 'clarification-qa',
    step: 'check-clarification-qa',
    systemPrompt: SYSTEM_PROMPT,
    maxRetries: MAX_RETRIES,
    createInitialMessages: () => [{ role: 'user', content: USER_PROMPT }],
    extractResult,
    validate,
    buildExecutionErrorPrompt: (error) => `执行失败：${error}\n请重新输出完整、合法的 <result> JSON。`,
    buildRepairPrompt: ({ stage, error, errors }) => {
      if (stage === 'extract') {
        return `提取失败：${error}\n请只输出单个合法的 <result> JSON，不要在标签外输出正文。`;
      }
      return [
        '验证失败，以下是具体问题：',
        (errors || []).map((item) => `- ${item}`).join('\n'),
        '',
        '格式提醒：',
        '- kind 必须是 "clarification_form"',
        '- payload 必须有 summary(字符串)、knownFacts(数组)、missingFields(数组，每项以 "blocking:" 或 "optional:" 开头)、questions(3-7 个)',
        '- 每个 question 必须有 id、label、question、selectionMode("single"或"multiple")、options(2-4 个)、placeholder',
        '- 每个 option 必须有 id、label、description，且至少一个设置 recommended:true',
        '',
        '请修正以上问题后重新输出完整的 <result> JSON。',
      ].join('\n');
    },
    onSuccess: async (parsed) => {
      const outPath = path.join(__dirname, '.clarification-qa-result.json');
      fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
    },
  }, options);

  printSummary(summary, options);
  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});

module.exports = {
  definition: {
    agent: 'clarification-qa',
    step: 'check-clarification-qa',
    systemPrompt: SYSTEM_PROMPT,
    maxRetries: MAX_RETRIES,
    createInitialMessages: () => [{ role: 'user', content: USER_PROMPT }],
    extractResult,
    validate,
    buildExecutionErrorPrompt: (error) => `执行失败：${error}\n请重新输出完整、合法的 <result> JSON。`,
    buildRepairPrompt: ({ stage, error, errors }) => {
      if (stage === 'extract') {
        return `提取失败：${error}\n请只输出单个合法的 <result> JSON，不要在标签外输出正文。`;
      }
      return [
        '验证失败，以下是具体问题：',
        (errors || []).map((item) => `- ${item}`).join('\n'),
        '',
        '格式提醒：',
        '- kind 必须是 "clarification_form"',
        '- payload 必须有 summary(字符串)、knownFacts(数组)、missingFields(数组，每项以 "blocking:" 或 "optional:" 开头)、questions(3-7 个)',
        '- 每个 question 必须有 id、label、question、selectionMode("single"或"multiple")、options(2-4 个)、placeholder',
        '- 每个 option 必须有 id、label、description，且至少一个设置 recommended:true',
        '',
        '请修正以上问题后重新输出完整的 <result> JSON。',
      ].join('\n');
    },
  },
};
