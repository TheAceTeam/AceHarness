#!/usr/bin/env node
/**
 * check-workflow-creator.cjs
 *
 * 使用 Haiku 4.5 真实调用 AI，测试 workflow-creator agent 能否产出通过验证的
 * workflow_draft <result> JSON（状态机模式）。
 *
 * 验证规则对齐 skills/aceharness-workflow-creator/scripts/validate-workflow.mjs
 * 和 src/lib/core/creator-validation.ts
 *
 * Usage:  npm run check:workflow-creator
 * Env:    ANTHROPIC_API_KEY
 * Exit:   0 = PASS, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');

const MODEL = 'claude-haiku-4-5-20250514';
const MAX_RETRIES = 2;
const MAX_TOKENS = 4096;

// ---------------------------------------------------------------------------
// System prompt (from SKILL.md + PROMPT.md)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Build user prompt - optionally load spec-coding result for task binding
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Result extraction
// ---------------------------------------------------------------------------

function extractResult(text) {
  const m = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) return { parsed: null, error: 'No <result>...</result> tags found' };
  try {
    return { parsed: JSON.parse(m[1].trim()), error: null };
  } catch (e) {
    try {
      const fixed = m[1].trim().replace(/,\s*(}|])/g, '$1');
      return { parsed: JSON.parse(fixed), error: null };
    } catch {
      return { parsed: null, error: `Invalid JSON: ${e.message}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Validation (mirrors validate-workflow.mjs + creator-validation.ts)
// ---------------------------------------------------------------------------

function validate(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return { valid: false, errors: ['Result must be object'] };
  if (result.kind !== 'workflow_draft') errors.push('kind must be "workflow_draft"');
  if (!result.payload || typeof result.payload !== 'object') return { valid: false, errors: [...errors, 'Missing payload'] };

  const p = result.payload;
  if (typeof p.filename !== 'string' || !p.filename.endsWith('.yaml')) errors.push('payload.filename must end with .yaml');
  if (!p.config || typeof p.config !== 'object') return { valid: false, errors: [...errors, 'payload.config missing'] };

  const cfg = p.config;
  if (!cfg.workflow || typeof cfg.workflow !== 'object') return { valid: false, errors: [...errors, 'config.workflow missing'] };
  if (!cfg.context || typeof cfg.context !== 'object') return { valid: false, errors: [...errors, 'config.context missing'] };

  // context
  const pr = cfg.context.projectRoot;
  if (typeof pr !== 'string' || !pr.startsWith('/')) errors.push('context.projectRoot must be absolute path (start with /)');

  // workflow states
  const wf = cfg.workflow;
  if (!Array.isArray(wf.states) || wf.states.length === 0) {
    errors.push('workflow.states must be non-empty array');
    return { valid: false, errors };
  }

  const stateNames = new Set();
  wf.states.forEach(s => stateNames.add(s.name));

  const initials = wf.states.filter(s => s.isInitial);
  const finals = wf.states.filter(s => s.isFinal);
  if (initials.length !== 1) errors.push(`Must have exactly 1 isInitial state (found ${initials.length})`);
  if (finals.length < 1) errors.push('Must have at least 1 isFinal state');

  const requiredVerdicts = ['pass', 'conditional_pass', 'fail'];

  for (const state of wf.states) {
    if (!state.name) { errors.push('State missing name'); continue; }

    if (state.isFinal) {
      // Final states should have empty steps/transitions
      if (state.steps && state.steps.length > 0) errors.push(`Final state "${state.name}": steps should be empty`);
      continue;
    }

    // Non-final: check steps
    if (!Array.isArray(state.steps) || state.steps.length === 0) {
      errors.push(`State "${state.name}": needs at least 1 step`);
    } else {
      for (const step of state.steps) {
        if (!step.name) errors.push(`State "${state.name}": step missing name`);
        if (!step.agent) errors.push(`State "${state.name}": step missing agent`);
        if (!step.task && !step.prompt) errors.push(`State "${state.name}": step missing task/prompt`);
      }
    }

    // Non-final: check transitions (exactly 3 verdicts)
    const transitions = Array.isArray(state.transitions) ? state.transitions : [];
    for (const verdict of requiredVerdicts) {
      const matches = transitions.filter(t => t?.condition?.verdict === verdict);
      if (matches.length === 0) errors.push(`State "${state.name}": missing ${verdict} transition`);
      else if (matches.length > 1) errors.push(`State "${state.name}": duplicate ${verdict} transition`);
    }

    // Check transition targets exist
    for (const t of transitions) {
      if (t.to && !stateNames.has(t.to)) errors.push(`State "${state.name}": transition target "${t.to}" not found`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Anthropic API
// ---------------------------------------------------------------------------

async function callHaiku(messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const sys = messages.find(m => m.role === 'system');
  const conv = messages.filter(m => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: sys?.content || '', messages: conv }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.map(b => b.text).join('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== check:workflow-creator (Haiku 4.5) ===\n');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt() },
  ];

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    console.log(`Attempt ${attempt}/${MAX_RETRIES + 1}...`);
    const t0 = Date.now();
    try {
      const output = await callHaiku(messages);
      console.log(`  AI responded in ${((Date.now() - t0) / 1000).toFixed(1)}s (${output.length} chars)`);

      const { parsed, error } = extractResult(output);
      if (error) {
        console.log(`  EXTRACT ERROR: ${error}`);
        if (attempt <= MAX_RETRIES) {
          messages.push({ role: 'assistant', content: output });
          messages.push({ role: 'user', content: `错误: ${error}\n请输出修正后的 <result> JSON。` });
          continue;
        }
        console.log('\nFAIL'); process.exit(1);
      }

      const { valid, errors } = validate(parsed);
      if (!valid) {
        console.log('  VALIDATION ERRORS:'); errors.forEach(e => console.log(`    - ${e}`));
        if (attempt <= MAX_RETRIES) {
          messages.push({ role: 'assistant', content: output });
          messages.push({ role: 'user', content: `验证失败:\n${errors.map(e => '- ' + e).join('\n')}\n\n请修正后重新输出 <result> JSON。记住：isInitial/isFinal 不是 initial/final，转移用 to 不是 target，每个非终止状态恰好 3 条 verdict 转移。` });
          continue;
        }
        console.log('\nFAIL'); process.exit(1);
      }

      // Success
      const wf = parsed.payload.config.workflow;
      console.log(`\n  PASS`);
      console.log(`    filename: ${parsed.payload.filename}`);
      console.log(`    states: ${wf.states.length} (${wf.states.map(s => s.name).join(' → ')})`);
      console.log(`    steps: ${wf.states.reduce((n, s) => n + (s.steps?.length || 0), 0)}`);
      process.exit(0);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      if (attempt > MAX_RETRIES) { console.log('\nFAIL'); process.exit(1); }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
