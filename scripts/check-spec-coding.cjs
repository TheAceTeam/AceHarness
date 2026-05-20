#!/usr/bin/env node
/**
 * check-spec-coding.cjs
 *
 * 通过当前仓库的 engine wrapper 真实调用 AI，检查 spec-coding agent 是否能产出
 * 符合校验规则的 plan_draft JSON，并统计通过率。
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

const SYSTEM_PROMPT = `你是 ACEHarness Spec Coding agent。将粗需求转化为三份结构化规范制品。

输出必须是单个 JSON 对象，放在 <result> 标签内。
格式：
<result>
{"kind":"plan_draft","payload":{"summary":"一句话概括","goals":["目标1"],"nonGoals":["非目标1"],"constraints":["约束1"],"clarification":{"summary":"当前状态","knownFacts":["事实1"],"missingFields":["缺失1"],"questions":["问题1"]},"artifacts":{"requirements":"requirements.md 全文","design":"design.md 全文","tasks":"tasks.md 全文"}}}
</result>

## 制品格式要求

### requirements.md
- 以 "# 需求文档：<名称>" 开头
- 包含 "## 需求" 章节
- 包含 "### 需求 N：<名称>" 条目
- 每个需求有 "**用户故事：**"
- 每个需求有 "#### 验收标准" + "WHEN ... THEN ..." 格式

### design.md
- 以 "# 设计文档：<名称>" 开头
- 包含 "## 概述" 章节
- 包含 \`\`\`mermaid 代码块或 "## 架构" 章节
- 包含 "## 关键决策" 章节和表格

### tasks.md
- 以 "# 实现计划：<名称>" 开头
- 包含 "## 任务" 章节
- 顶层任务格式："- [ ] T1 <标题>" 或 "- [ ] 1. <标题>"（推荐 T 前缀）
- 子任务格式："  - [ ] T1.1 <标题>" 或 "  - [ ] 1.1 <标题>"
- 包含需求引用："_需求：T1_" 或 "_需求：1.1_"
- 至少一个检查点："- [ ] TN 检查点 - ..." 或 "- [ ] N. 检查点 - ..."

## 禁止事项
- 不要在 <result> 外面输出 JSON
- 不要输出多个 <result>
- JSON 必须合法（无注释、无尾逗号）
`;

function buildUserPrompt() {
  let clarificationContext = '';
  const clarificationPath = path.join(__dirname, '.clarification-qa-result.json');
  if (fs.existsSync(clarificationPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(clarificationPath, 'utf-8'));
      const payload = raw.payload || raw;
      const summary = payload.summary || '';
      const questions = Array.isArray(payload.questions) ? payload.questions : [];
      if (summary || questions.length > 0) {
        const answerLines = questions.map((q) => {
          const rec = (q.options || []).find((o) => o.recommended);
          return `- ${q.label}：选择：${rec ? rec.label : (q.options?.[0]?.label || '默认')}`;
        });
        clarificationContext = [
          '',
          '以下是已完成的需求澄清问答结果：',
          summary ? `澄清结论：${summary}` : '',
          answerLines.length > 0 ? `用户补充回答：\n${answerLines.join('\n')}` : '',
        ].filter(Boolean).join('\n');
      }
    } catch {}
  }

  return `请基于已完成的澄清问答开始生成正式计划草案。

项目：构建一个在线文档协作编辑器
原始需求：
- 多人实时协同编辑（基于 CRDT）
- 文档版本历史和回滚
- 权限管理（查看/编辑/管理员）
- Markdown 和富文本双模式
${clarificationContext}
请生成完整的 requirements.md、design.md、tasks.md，放入 plan_draft JSON 中。
输出在 <result> 标签内。`;
}

const extractResult = extractResultTag;

function extractHeadings(text, level) {
  const re = new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm');
  return (text.match(re) || []).map((h) => h.replace(/^#+\s*/, '').trim());
}

function firstLines(text, n) {
  return text.split(/\r?\n/).filter((l) => l.trim()).slice(0, n).join(' | ');
}

function validate(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return { valid: false, errors: ['Result must be object'] };

  let payload = result;
  if (result.kind === 'plan_draft' && result.payload) payload = result.payload;
  else if (result.type === 'plan_draft') payload = result;

  const arts = payload.artifacts || payload;
  const req = typeof arts.requirements === 'string' ? arts.requirements : '';
  const des = typeof arts.design === 'string' ? arts.design : '';
  const tsk = typeof arts.tasks === 'string' ? arts.tasks : '';

  if (!req) errors.push('artifacts.requirements 为空或缺失。payload 的顶层 key 有: [' + Object.keys(payload).join(', ') + ']');
  if (!des) errors.push('artifacts.design 为空或缺失。payload 的顶层 key 有: [' + Object.keys(payload).join(', ') + ']');
  if (!tsk) errors.push('artifacts.tasks 为空或缺失。payload 的顶层 key 有: [' + Object.keys(payload).join(', ') + ']');
  if (errors.length > 0) return { valid: false, errors };

  // --- requirements.md ---
  if (!/^# 需求文档[：:].+/m.test(req)) {
    const h1 = extractHeadings(req, 1);
    errors.push(`requirements: 第一行必须是 "# 需求文档：<名称>"，但实际的一级标题是: ${h1.length ? h1.map((h) => '"' + h + '"').join(', ') : '(无一级标题)'}。前 80 字符: "${req.slice(0, 80)}"`);
  }
  if (!/^## 需求$/m.test(req)) {
    const h2 = extractHeadings(req, 2);
    errors.push(`requirements: 缺少独立的 "## 需求" 二级标题。当前的二级标题有: ${h2.length ? h2.map((h) => '"' + h + '"').join(', ') : '(无二级标题)'}。需要一个文本完全是 "## 需求" 的行`);
  }
  if (!/^### 需求 \d+[：:].+/m.test(req)) {
    const h3 = extractHeadings(req, 3);
    errors.push(`requirements: 缺少 "### 需求 N：<名称>" 格式的三级标题。当前的三级标题有: ${h3.length ? h3.map((h) => '"' + h + '"').join(', ') : '(无三级标题)'}。正确示例: "### 需求 1：用户注册"`);
  }
  if (!/\*\*用户故事[：:]\*\*/m.test(req)) {
    errors.push('requirements: 缺少 "**用户故事：**" 标记。每个需求下必须有 **用户故事：** 开头的段落，例如 "**用户故事：** 作为管理员，我希望..."');
  }
  if (!/^#### 验收标准$/m.test(req)) {
    const h4 = extractHeadings(req, 4);
    errors.push(`requirements: 缺少 "#### 验收标准" 四级标题。当前的四级标题有: ${h4.length ? h4.map((h) => '"' + h + '"').join(', ') : '(无四级标题)'}。每个需求下必须有独立的 "#### 验收标准" 章节`);
  }
  if (!/WHEN .+ THEN .+/m.test(req)) {
    errors.push('requirements: 验收标准中缺少 "WHEN ... THEN ..." 格式。正确示例: "WHEN 用户提交表单 THEN 系统返回成功提示"');
  }

  // --- design.md ---
  if (!/^# 设计文档[：:].+/m.test(des)) {
    const h1 = extractHeadings(des, 1);
    errors.push(`design: 第一行必须是 "# 设计文档：<名称>"，但实际的一级标题是: ${h1.length ? h1.map((h) => '"' + h + '"').join(', ') : '(无一级标题)'}。前 80 字符: "${des.slice(0, 80)}"`);
  }
  if (!/^## 概述$/m.test(des)) {
    const h2 = extractHeadings(des, 2);
    errors.push(`design: 缺少 "## 概述" 二级标题。当前的二级标题有: ${h2.length ? h2.map((h) => '"' + h + '"').join(', ') : '(无二级标题)'}`);
  }
  if (!/```mermaid/m.test(des) && !/^## 架构$/m.test(des)) {
    errors.push('design: 缺少 mermaid 代码块（```mermaid）或 "## 架构" 章节。必须至少包含其中一个。注意: mermaid 代码块需要用 ```mermaid 开头（如果在 JSON 字符串内，用 ~~~mermaid）');
  }
  if (!/^## 关键决策$/m.test(des)) {
    const h2 = extractHeadings(des, 2);
    errors.push(`design: 缺少 "## 关键决策" 二级标题。当前的二级标题有: ${h2.length ? h2.map((h) => '"' + h + '"').join(', ') : '(无二级标题)'}`);
  }
  if (!/^\|[^|]+\|[^|]+\|[^|]+\|/m.test(des)) {
    errors.push('design: "## 关键决策" 下缺少 markdown 表格。需要 "| 决策 | 选择 | 理由 |" 格式的表格（至少 3 列，至少 1 行数据）');
  }

  // --- tasks.md ---
  if (!/^# 实现计划[：:].+/m.test(tsk)) {
    const h1 = extractHeadings(tsk, 1);
    errors.push(`tasks: 第一行必须是 "# 实现计划：<名称>"，但实际的一级标题是: ${h1.length ? h1.map((h) => '"' + h + '"').join(', ') : '(无一级标题)'}。前 80 字符: "${tsk.slice(0, 80)}"`);
  }
  if (!/^## 任务$/m.test(tsk)) {
    const h2 = extractHeadings(tsk, 2);
    errors.push(`tasks: 缺少 "## 任务" 二级标题。当前的二级标题有: ${h2.length ? h2.map((h) => '"' + h + '"').join(', ') : '(无二级标题)'}`);
  }
  const topTasks = tsk.match(/^- \[[ xX-]\] (?:[A-Za-z]+)?\d+[\.\s]/gm) || [];
  if (!topTasks.length) {
    const checkboxLines = tsk.match(/^- \[[ xX-]\] .+/gm) || [];
    errors.push(`tasks: 缺少编号顶层任务。需要 "- [ ] T1 标题" 或 "- [ ] 1. 标题" 格式。当前找到 ${checkboxLines.length} 行 checkbox，但都不符合编号格式。${checkboxLines.length ? '第一行: "' + checkboxLines[0].trim().slice(0, 80) + '"' : ''}`);
  }
  const subTasks = tsk.match(/^\s{2,}- \[[ xX-]\] (?:[A-Za-z]+)?\d+\.\d+/gm) || [];
  if (!subTasks.length) {
    const indentedCheckboxes = tsk.match(/^\s{2,}- \[[ xX-]\] .+/gm) || [];
    errors.push(`tasks: 缺少编号子任务。需要 "  - [ ] T1.1 标题" 或 "  - [ ] 1.1 标题" 格式（2空格缩进）。当前找到 ${indentedCheckboxes.length} 行缩进 checkbox，但都不符合编号格式。${indentedCheckboxes.length ? '第一行: "' + indentedCheckboxes[0].trim().slice(0, 80) + '"' : ''}`);
  }
  if (!/_需求[：:].+?_/m.test(tsk)) {
    errors.push('tasks: 缺少需求引用。子任务下方需要 "_需求：T1_" 或 "_需求：1.1_" 格式的引用行');
  }
  const checkpoints = tsk.match(/^- \[[ xX-]\] (?:[A-Za-z]+)?\d+[\.\s].*检查点/gm) || [];
  if (!checkpoints.length) {
    errors.push(`tasks: 缺少检查点任务。需要至少一个包含"检查点"关键词的顶层任务，例如 "- [ ] T3 检查点 - 验证核心功能"。当前共 ${topTasks.length} 个顶层任务，但都不包含"检查点"关键词`);
  }

  return { valid: errors.length === 0, errors };
}

function printSummary(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`=== check:spec-coding (${summary.engine}/${summary.driver}, ${summary.model}) ===\n`);
  for (const run of summary.runs) {
    const label = run.ok ? 'PASS' : 'FAIL';
    console.log(`Run ${run.run}/${summary.total}: ${label} (${(run.durationMs / 1000).toFixed(1)}s)`);
    if (run.sessionId) console.log(`  session: ${run.sessionId}`);
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
    printCommonHelp('check:spec-coding', '\n示例:\n  npm run check:spec-coding -- --engine opencode --driver sdk --model glm-4.7 --runs 3');
    process.exit(0);
  }

  const summary = await runCheckSuite({
    agent: 'spec-coding',
    step: 'check-spec-coding',
    systemPrompt: SYSTEM_PROMPT,
    maxRetries: MAX_RETRIES,
    createInitialMessages: () => [{ role: 'user', content: buildUserPrompt() }],
    extractResult,
    validate,
    buildExecutionErrorPrompt: (error) => `执行失败：${error}\n请重新输出完整、合法的 <result> JSON。`,
    buildRepairPrompt: ({ stage, error, errors }) => {
      if (stage === 'extract') {
        return `提取失败：${error}\n请只输出单个合法的 <result> JSON，不要在标签外输出正文。`;
      }
      return [
        '制品校验失败：',
        (errors || []).map((item) => `- ${item}`).join('\n'),
        '',
        '格式提醒：',
        '- requirements.md: 以 "# 需求文档：<名称>" 开头，包含 "## 需求"、"### 需求 N：" 条目、用户故事、WHEN/THEN 验收标准',
        '- design.md: 以 "# 设计文档：<名称>" 开头，包含 "## 概述"、mermaid 图或 "## 架构"、"## 关键决策" + 表格',
        '- tasks.md: 以 "# 实现计划：<名称>" 开头，包含 "## 任务"、顶层 "- [ ] T1 ..." 或 "- [ ] 1. ..."、子任务 "  - [ ] T1.1 ..."、需求引用 "_需求：T1_"、检查点任务',
        '',
        '请修正以上问题后重新输出完整的 <result> JSON。',
      ].join('\n');
    },
    onSuccess: async (parsed) => {
      const outPath = path.join(__dirname, '.spec-coding-result.json');
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
    agent: 'spec-coding',
    step: 'check-spec-coding',
    systemPrompt: SYSTEM_PROMPT,
    maxRetries: MAX_RETRIES,
    createInitialMessages: () => [{ role: 'user', content: buildUserPrompt() }],
    extractResult,
    validate,
    buildExecutionErrorPrompt: (error) => `执行失败：${error}\n请重新输出完整、合法的 <result> JSON。`,
    buildRepairPrompt: ({ stage, error, errors }) => {
      if (stage === 'extract') {
        return `提取失败：${error}\n请只输出单个合法的 <result> JSON，不要在标签外输出正文。`;
      }
      return [
        '制品校验失败：',
        (errors || []).map((item) => `- ${item}`).join('\n'),
        '',
        '格式提醒：',
        '- requirements.md: 以 "# 需求文档：<名称>" 开头，包含 "## 需求"、"### 需求 N：" 条目、用户故事、WHEN/THEN 验收标准',
        '- design.md: 以 "# 设计文档：<名称>" 开头，包含 "## 概述"、mermaid 图或 "## 架构"、"## 关键决策" + 表格',
        '- tasks.md: 以 "# 实现计划：<名称>" 开头，包含 "## 任务"、顶层 "- [ ] T1 ..." 或 "- [ ] 1. ..."、子任务 "  - [ ] T1.1 ..."、需求引用 "_需求：T1_"、检查点任务',
        '',
        '请修正以上问题后重新输出完整的 <result> JSON。',
      ].join('\n');
    },
    onSuccess: async (parsed) => {
      const outPath = path.join(__dirname, '.spec-coding-result.json');
      fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
    },
  },
};
