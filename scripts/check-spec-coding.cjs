#!/usr/bin/env node
/**
 * check-spec-coding.cjs
 *
 * 使用 Haiku 4.5 真实调用 AI，测试 spec-coding agent 能否产出符合校验规则的
 * plan_draft JSON（含 requirements/design/tasks 三份 markdown 制品）。
 *
 * 验证规则对齐 skills/aceharness-spec-coding/scripts/validate-spec-coding.mjs
 *
 * Usage:  npm run check:spec-coding
 * Env:    ANTHROPIC_API_KEY
 * Exit:   0 = PASS, 1 = FAIL
 */

const fs = require('fs');
const path = require('path');

const MODEL = 'claude-haiku-4-5-20250514';
const MAX_RETRIES = 2;
const MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// System prompt (simplified from SKILL.md + PROMPT.md)
// ---------------------------------------------------------------------------

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
- 顶层任务格式："- [ ] N. <标题>"
- 子任务格式："  - [ ] N.M <标题>"
- 包含需求引用："_需求：x.x_"
- 至少一个检查点："- [ ] N. 检查点 - ..."

## 禁止事项
- 不要在 <result> 外面输出 JSON
- 不要输出多个 <result>
- JSON 必须合法（无注释、无尾逗号）
`;

const USER_PROMPT = `请为以下项目生成 spec-coding 制品：

项目：构建一个在线文档协作编辑器
功能要求：
- 多人实时协同编辑（基于 CRDT）
- 文档版本历史和回滚
- 权限管理（查看/编辑/管理员）
- Markdown 和富文本双模式

请生成完整的 requirements.md、design.md、tasks.md，放入 plan_draft JSON 中。
输出在 <result> 标签内。`;

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
// Validation (mirrors validate-spec-coding.mjs logic)
// ---------------------------------------------------------------------------

function validate(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return { valid: false, errors: ['Result must be object'] };

  // Normalize: support both {kind,payload} and {type,...} formats
  let payload = result;
  if (result.kind === 'plan_draft' && result.payload) payload = result.payload;
  else if (result.type === 'plan_draft') payload = result;

  const arts = payload.artifacts || payload;
  const req = typeof arts.requirements === 'string' ? arts.requirements : '';
  const des = typeof arts.design === 'string' ? arts.design : '';
  const tsk = typeof arts.tasks === 'string' ? arts.tasks : '';

  if (!req) errors.push('artifacts.requirements is empty/missing');
  if (!des) errors.push('artifacts.design is empty/missing');
  if (!tsk) errors.push('artifacts.tasks is empty/missing');
  if (errors.length > 0) return { valid: false, errors };

  // requirements.md checks
  if (!/^# 需求文档[：:].+/m.test(req)) errors.push('requirements: 需以 "# 需求文档：<名称>" 开头');
  if (!/^## 需求$/m.test(req)) errors.push('requirements: 缺少 "## 需求" 章节');
  if (!/^### 需求 \d+[：:].+/m.test(req)) errors.push('requirements: 缺少 "### 需求 N：<名称>"');
  if (!/\*\*用户故事[：:]\*\*/m.test(req)) errors.push('requirements: 缺少用户故事');
  if (!/^#### 验收标准$/m.test(req)) errors.push('requirements: 缺少 "#### 验收标准"');
  if (!/WHEN .+ THEN .+/m.test(req)) errors.push('requirements: 缺少 WHEN/THEN 验收标准');

  // design.md checks
  if (!/^# 设计文档[：:].+/m.test(des)) errors.push('design: 需以 "# 设计文档：<名称>" 开头');
  if (!/^## 概述$/m.test(des)) errors.push('design: 缺少 "## 概述"');
  if (!/```mermaid/m.test(des) && !/^## 架构$/m.test(des)) errors.push('design: 缺少 mermaid 图或 "## 架构" 章节');
  if (!/^## 关键决策$/m.test(des)) errors.push('design: 缺少 "## 关键决策"');
  if (!/^\|[^|]+\|[^|]+\|[^|]+\|/m.test(des)) errors.push('design: 关键决策表缺少数据行');

  // tasks.md checks
  if (!/^# 实现计划[：:].+/m.test(tsk)) errors.push('tasks: 需以 "# 实现计划：<名称>" 开头');
  if (!/^## 任务$/m.test(tsk)) errors.push('tasks: 缺少 "## 任务"');
  if (!(tsk.match(/^- \[[ xX-]\] \d+\./gm) || []).length) errors.push('tasks: 缺少顶层任务 "- [ ] N. ..."');
  if (!(tsk.match(/^\s{2,}- \[[ xX-]\] \d+\.\d+/gm) || []).length) errors.push('tasks: 缺少子任务 "  - [ ] N.M ..."');
  if (!/_需求[：:].+?_/m.test(tsk)) errors.push('tasks: 缺少需求引用 "_需求：x.x_"');
  if (!(tsk.match(/^- \[[ xX-]\] \d+\.\s*检查点/gm) || []).length) errors.push('tasks: 缺少检查点任务');

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
  console.log('=== check:spec-coding (Haiku 4.5) ===\n');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT },
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
          messages.push({ role: 'user', content: `制品校验失败:\n${errors.map(e => '- ' + e).join('\n')}\n\n请修正后重新输出 <result> JSON。` });
          continue;
        }
        console.log('\nFAIL'); process.exit(1);
      }

      // Success - save result for workflow-creator to consume
      const outPath = path.join(__dirname, '.spec-coding-result.json');
      fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
      console.log(`\n  PASS - 三份制品全部通过校验`);
      console.log(`  saved → ${outPath}`);
      process.exit(0);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      if (attempt > MAX_RETRIES) { console.log('\nFAIL'); process.exit(1); }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
