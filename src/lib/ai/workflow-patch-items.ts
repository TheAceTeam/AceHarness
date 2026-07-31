import { extractJsonObject, getResultSections } from '@/lib/ai/result-channel';

export const WORKFLOW_PATCH_ITEM_KIND = 'workflow_patch_item';

export type WorkflowPatchItemResult = {
  kind: typeof WORKFLOW_PATCH_ITEM_KIND;
  data: Record<string, any>;
};

export type WorkflowPatchItemExtraction =
  | { ok: true; result: WorkflowPatchItemResult }
  | { ok: false; error: string };

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getPayload(raw: any): Record<string, any> {
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : raw;
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return data && typeof data === 'object' ? data : {};
}

function previewValue(value: unknown, limit = 320): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return String(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function validationError(path: string, problem: string, fix: string): string {
  return `错误字段：${path}。问题：${problem}。修改方式：${fix}`;
}

function extractionDiagnostic(markdown: string): string {
  const sections = getResultSections(markdown);
  const expected = `<result>{"kind":"${WORKFLOW_PATCH_ITEM_KIND}","data":{...}}</result>`;
  if (sections.length === 0) {
    const hasOpenTag = /<result>/i.test(markdown);
    const hasCloseTag = /<\/result>/i.test(markdown);
    return [
      `未检测到 ${WORKFLOW_PATCH_ITEM_KIND} 结果。`,
      `检测结果：<result> 块数量=0；openTag=${hasOpenTag ? 'yes' : 'no'}；closeTag=${hasCloseTag ? 'yes' : 'no'}。`,
      `修改方式：在回复末尾补发一个机器结果块，形如 ${expected}。`,
      '<result> 内只能是一个裸 JSON 对象，不能包 Markdown 代码块。',
    ].join('\n');
  }

  const diagnostics = sections.map((section, index) => {
    const parsed = extractJsonObject(section.content);
    if (!parsed || typeof parsed !== 'object') {
      return `第 ${index + 1} 个 <result>：JSON 解析失败或不是对象；内容片段=${previewValue(section.content)}。`;
    }
    return `第 ${index + 1} 个 <result>：kind=${cleanString(parsed.kind) || '(missing)'}；顶层 keys=${Object.keys(parsed).join(', ') || 'none'}。`;
  }).join('\n');

  return [
    `未检测到符合要求的 ${WORKFLOW_PATCH_ITEM_KIND} 结果。`,
    diagnostics,
    `修改方式：补发一个顶层 kind 精确为 "${WORKFLOW_PATCH_ITEM_KIND}" 的结果块，形如 ${expected}。`,
  ].join('\n');
}

export function validateWorkflowPatchItem(
  result: WorkflowPatchItemResult,
): { ok: boolean; errors: string[] } {
  const data = result.data || {};
  const errors: string[] = [];
  if (!['workflow', 'state', 'step'].includes(data.scope)) {
    errors.push(validationError('data.scope', 'scope 不是 workflow/state/step。', '根据当前优化目标把 scope 改为 workflow、state 或 step。'));
  }
  if (data.workflowMode !== 'state-machine') {
    errors.push(validationError('data.workflowMode', 'workflowMode 必须是 state-machine。', '填写 "workflowMode":"state-machine"。'));
  }
  if (!data.patch || typeof data.patch !== 'object' || Array.isArray(data.patch)) {
    errors.push(validationError('data.patch', 'patch 缺失或不是对象。', '在 data.patch 中放入当前 scope 对应的 workflow、state 或 step 对象。'));
  }
  return { ok: errors.length === 0, errors };
}

export function extractWorkflowPatchItemResult(markdown: string): WorkflowPatchItemExtraction {
  for (const section of getResultSections(markdown)) {
    const parsed = extractJsonObject(section.content);
    if (!parsed || typeof parsed !== 'object' || cleanString(parsed.kind) !== WORKFLOW_PATCH_ITEM_KIND) continue;

    const result: WorkflowPatchItemResult = {
      kind: WORKFLOW_PATCH_ITEM_KIND,
      data: getPayload(parsed),
    };
    const validation = validateWorkflowPatchItem(result);
    if (!validation.ok) return { ok: false, error: validation.errors.join('\n') };
    return { ok: true, result };
  }

  return { ok: false, error: extractionDiagnostic(markdown) };
}
