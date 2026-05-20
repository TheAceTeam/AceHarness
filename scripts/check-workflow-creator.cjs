#!/usr/bin/env node
/**
 * check-workflow-creator.cjs
 *
 * 通过当前仓库的 engine wrapper 真实调用 AI，检查 workflow-creator agent 是否能产出
 * 通过验证的 workflow_draft JSON，并统计通过率。
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

const SYSTEM_PROMPT = `你是 ACEHarness 工作流创建器。根据用户描述的测试/评审流程，生成一个 ACEHarness 状态机工作流配置。

输出格式：在 <result> 标签内放单个 JSON 对象（不要换行、不要注释）。

<result>
{"kind":"workflow_draft","payload":{"filename":"xxx.yaml","summary":"一句话描述","config":{"workflow":{"mode":"state-machine","name":"工作流名","states":[...]},"context":{"projectRoot":"/绝对路径","workspaceMode":"in-place"}}}}
</result>

## 规则

1. kind = "workflow_draft"
2. payload.filename 以 .yaml 结尾
3. payload.config 含 workflow + context
4. context.projectRoot 以 / 开头（绝对路径）
5. workflow.mode = "state-machine"
6. workflow.states 数组：
   - 恰好 1 个 isInitial: true
   - 至少 1 个 isFinal: true
   - 非终止状态恰好 3 条转移: pass / conditional_pass / fail
   - 转移用 "to"（不是 target），指向已有状态名
   - 终止状态 steps=[] transitions=[]
7. step 格式: {name, agent, task}
   - task 是给 agent 的指令字符串

## 字段名注意
- isInitial（不是 initial）
- isFinal（不是 final）
- to（不是 target）
- verdict（不是 result）

## 完整最小示例
<result>
{"kind":"workflow_draft","payload":{"filename":"review.yaml","summary":"代码审查","config":{"workflow":{"mode":"state-machine","name":"代码审查","states":[{"name":"审查","isInitial":true,"steps":[{"name":"审查代码","agent":"reviewer","task":"审查代码质量"}],"transitions":[{"to":"完成","condition":{"verdict":"pass"}},{"to":"完成","condition":{"verdict":"conditional_pass"}},{"to":"审查","condition":{"verdict":"fail"}}]},{"name":"完成","isFinal":true,"steps":[],"transitions":[]}]},"context":{"projectRoot":"/Users/example/project","workspaceMode":"in-place"}}}}
</result>
`;

function buildUserPrompt() {
  let specContext = '';
  const specPath = path.join(__dirname, '.spec-coding-result.json');
  if (fs.existsSync(specPath)) {
    try {
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
      const payload = spec.payload || spec;
      const tasks = payload.artifacts?.tasks || '';
      if (tasks) {
        specContext = `\n\n以下是已生成的 tasks.md（spec-coding 的输出），请基于此设计工作流状态：\n\n\`\`\`markdown\n${tasks.slice(0, 2000)}\n\`\`\`\n`;
      }
    } catch {}
  }

  return `请为以下项目创建一个状态机工作流：

项目：在线文档协作编辑器
流程：
1. 需求确认阶段（defender 实现 + attacker 审查 + judge 裁决）
2. 开发实现阶段（defender 编码 + attacker 代码审查 + judge 裁决）
3. 测试验证阶段（defender 写测试 + attacker 找 bug + judge 裁决）
4. 完成状态

工作目录: /Users/dev/collab-editor
${specContext}
请输出 <result> 标签包裹的 workflow_draft JSON。`;
}

const extractResult = extractResultTag;

function validate(result) {
  const errors = [];
  if (!result || typeof result !== 'object') {
    return { valid: false, errors: [`结果必须是 JSON 对象，但实际类型是 ${typeof result}。确保 <result> 内是合法 JSON`] };
  }

  if (result.kind !== 'workflow_draft') {
    errors.push(`kind 必须是 "workflow_draft"，但实际值是 ${JSON.stringify(result.kind)}。顶层 key 有: [${Object.keys(result).join(', ')}]`);
  }
  if (!result.payload || typeof result.payload !== 'object') {
    return { valid: false, errors: [...errors, `缺少 payload 对象。顶层 key 有: [${Object.keys(result).join(', ')}]。正确结构: {"kind":"workflow_draft","payload":{"filename":"...","summary":"...","config":{...}}}`] };
  }

  const p = result.payload;
  if (typeof p.filename !== 'string' || !p.filename.endsWith('.yaml')) {
    errors.push(`payload.filename 必须以 .yaml 结尾，但实际值是 ${JSON.stringify(p.filename)}。示例: "review.yaml"`);
  }
  if (!p.config || typeof p.config !== 'object') {
    return { valid: false, errors: [...errors, `payload.config 缺失。payload 的 key 有: [${Object.keys(p).join(', ')}]。config 必须包含 workflow 和 context 两个子对象`] };
  }

  const cfg = p.config;
  if (!cfg.workflow || typeof cfg.workflow !== 'object') {
    return { valid: false, errors: [...errors, `config.workflow 缺失。config 的 key 有: [${Object.keys(cfg).join(', ')}]。workflow 必须包含 mode、name、states`] };
  }
  if (!cfg.context || typeof cfg.context !== 'object') {
    return { valid: false, errors: [...errors, `config.context 缺失。config 的 key 有: [${Object.keys(cfg).join(', ')}]。context 必须包含 projectRoot 和 workspaceMode`] };
  }

  const pr = cfg.context.projectRoot;
  if (typeof pr !== 'string' || !pr.startsWith('/')) {
    errors.push(`context.projectRoot 必须是绝对路径（以 / 开头），但实际值是 ${JSON.stringify(pr)}。示例: "/Users/dev/collab-editor"`);
  }

  const wf = cfg.workflow;
  if (!Array.isArray(wf.states) || wf.states.length === 0) {
    errors.push(`workflow.states 必须是非空数组，但实际 ${wf.states === undefined ? '不存在' : Array.isArray(wf.states) ? '是空数组 []' : `类型是 ${typeof wf.states}`}。workflow 的 key 有: [${Object.keys(wf).join(', ')}]`);
    return { valid: false, errors };
  }

  const stateNames = new Set();
  wf.states.forEach((state) => stateNames.add(state.name));
  const allStateNames = [...stateNames].filter(Boolean);

  const initials = wf.states.filter((state) => state.isInitial);
  const finals = wf.states.filter((state) => state.isFinal);
  if (initials.length !== 1) {
    const initialNames = initials.map((s) => `"${s.name}"`).join(', ');
    errors.push(`必须恰好有 1 个 isInitial 状态，但找到 ${initials.length} 个${initials.length > 0 ? ` [${initialNames}]` : ''}。所有状态: [${allStateNames.map((n) => `"${n}"`).join(', ')}]。注意: 用 isInitial（不是 initial）`);
  }
  if (finals.length < 1) {
    errors.push(`必须至少有 1 个 isFinal 状态，但找到 0 个。所有状态: [${allStateNames.map((n) => `"${n}"`).join(', ')}]。注意: 用 isFinal（不是 final），终止状态的 steps=[] transitions=[]`);
  }

  const requiredVerdicts = ['pass', 'conditional_pass', 'fail'];

  for (let si = 0; si < wf.states.length; si++) {
    const state = wf.states[si];
    if (!state.name) {
      errors.push(`states[${si}] 缺少 name 字段。该状态的 key 有: [${Object.keys(state).join(', ')}]`);
      continue;
    }

    if (state.isFinal) {
      if (state.steps && state.steps.length > 0) {
        errors.push(`终止状态 "${state.name}": steps 必须为空数组，但实际有 ${state.steps.length} 个 step。终止状态不执行任何操作，设置 steps:[] transitions:[]`);
      }
      continue;
    }

    if (!Array.isArray(state.steps) || state.steps.length === 0) {
      errors.push(`状态 "${state.name}": 非终止状态必须至少有 1 个 step，但 ${state.steps === undefined ? 'steps 不存在' : Array.isArray(state.steps) ? 'steps 是空数组' : `steps 类型是 ${typeof state.steps}`}。step 格式: {"name":"...","agent":"...","task":"..."}`);
    } else {
      for (let j = 0; j < state.steps.length; j++) {
        const step = state.steps[j];
        const stepKeys = step && typeof step === 'object' ? Object.keys(step) : [];
        const stepMissing = [];
        if (!step.name) stepMissing.push('name');
        if (!step.agent) stepMissing.push('agent');
        if (!step.task && !step.prompt) stepMissing.push('task');
        if (stepMissing.length > 0) {
          errors.push(`状态 "${state.name}" 的 steps[${j}] 缺少字段 [${stepMissing.join(', ')}]。当前有的 key: [${stepKeys.join(', ')}]。step 必须有 name、agent、task`);
        }
      }
    }

    const transitions = Array.isArray(state.transitions) ? state.transitions : [];
    const foundVerdicts = transitions.map((t) => t?.condition?.verdict).filter(Boolean);
    for (const verdict of requiredVerdicts) {
      const matches = transitions.filter((transition) => transition?.condition?.verdict === verdict);
      if (matches.length === 0) {
        errors.push(`状态 "${state.name}": 缺少 verdict="${verdict}" 的转移。当前有 ${transitions.length} 条转移，verdict 分别是 [${foundVerdicts.map((v) => `"${v}"`).join(', ') || '无'}]。非终止状态必须恰好有 pass、conditional_pass、fail 三条转移`);
      } else if (matches.length > 1) {
        errors.push(`状态 "${state.name}": verdict="${verdict}" 的转移重复了 ${matches.length} 次，必须恰好 1 次`);
      }
    }

    for (const transition of transitions) {
      const target = transition.target || transition.to;
      if (transition.target && !transition.to) {
        errors.push(`状态 "${state.name}": 转移使用了 "target":"${transition.target}"，但正确的字段名是 "to"（不是 target）。改为 "to":"${transition.target}"`);
      }
      if (transition.to && !stateNames.has(transition.to)) {
        errors.push(`状态 "${state.name}": 转移目标 "${transition.to}" 不在已定义的状态列表中。可用状态: [${allStateNames.map((n) => `"${n}"`).join(', ')}]`);
      }
    }
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
    const label = run.ok ? 'PASS' : 'FAIL';
    console.log(`Run ${run.run}/${summary.total}: ${label} (${(run.durationMs / 1000).toFixed(1)}s)`);
    if (run.sessionId) console.log(`  session: ${run.sessionId}`);
    if (run.ok && run.parsed?.payload?.filename) console.log(`  filename: ${run.parsed.payload.filename}`);
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
    printCommonHelp('check:workflow-creator', '\n示例:\n  npm run check:workflow-creator -- --engine opencode --driver sdk --model glm-4.7 --runs 3');
    process.exit(0);
  }

  const summary = await runCheckSuite({
    agent: 'workflow-creator',
    step: 'check-workflow-creator',
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
        '验证失败，以下是具体问题：',
        (errors || []).map((item) => `- ${item}`).join('\n'),
        '',
        '格式提醒：',
        '- kind 必须是 "workflow_draft"',
        '- 字段名: isInitial（不是 initial）、isFinal（不是 final）、to（不是 target）、verdict（不是 result）',
        '- 非终止状态恰好 3 条转移: pass / conditional_pass / fail，用 condition.verdict 指定',
        '- 终止状态: steps=[] transitions=[]',
        '- step 格式: {"name":"...","agent":"...","task":"..."}',
        '- 转移格式: {"to":"目标状态名","condition":{"verdict":"pass"}}',
        '',
        '请修正以上问题后重新输出完整的 <result> JSON。',
      ].join('\n');
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
    agent: 'workflow-creator',
    step: 'check-workflow-creator',
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
        '验证失败，以下是具体问题：',
        (errors || []).map((item) => `- ${item}`).join('\n'),
        '',
        '格式提醒：',
        '- kind 必须是 "workflow_draft"',
        '- 字段名: isInitial（不是 initial）、isFinal（不是 final）、to（不是 target）、verdict（不是 result）',
        '- 非终止状态恰好 3 条转移: pass / conditional_pass / fail，用 condition.verdict 指定',
        '- 终止状态: steps=[] transitions=[]',
        '- step 格式: {"name":"...","agent":"...","task":"..."}',
        '- 转移格式: {"to":"目标状态名","condition":{"verdict":"pass"}}',
        '',
        '请修正以上问题后重新输出完整的 <result> JSON。',
      ].join('\n');
    },
  },
};
