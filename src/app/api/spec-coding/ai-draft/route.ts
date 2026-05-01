import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { buildSpecCodingFromWorkflowConfig } from '@/lib/spec-coding-store';
import { buildDashboardSystemPrompt } from '@/lib/chat-system-prompt';
import { loadChatSettings } from '@/lib/chat-settings';
import { createEngine, getConfiguredEngine, type EngineType } from '@/lib/engines/engine-factory';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/creator-validation';
import {
  extractJsonObject,
  normalizeStringArray,
  applyAiSpecCodingDraft,
  buildFallbackClarification,
} from '@/lib/ai-draft-utils';

export { extractJsonObject, normalizeStringArray, applyAiSpecCodingDraft, buildFallbackClarification } from '@/lib/ai-draft-utils';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const workflowName = String(body.workflowName || '').trim();
    const filename = String(body.filename || '').trim();
    const workingDirectory = String(body.workingDirectory || '').trim();
    const workspaceMode = body.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place';
    const description = String(body.description || '').trim();
    const requirements = String(body.requirements || '').trim();
    const referenceWorkflow = String(body.referenceWorkflow || '').trim();
    const config = body.config;
    const draft = body.draft && typeof body.draft === 'object' ? body.draft : null;

    if (!workflowName || !filename || !workingDirectory || !config) {
      return NextResponse.json({ error: '缺少生成计划草案所需参数' }, { status: 400 });
    }

    const baseSpecCoding = buildSpecCodingFromWorkflowConfig({
      workflowName,
      description,
      requirements,
      filename,
      workspaceMode,
      workingDirectory,
      config,
    });
    const configValidation = validateWorkflowDraft(config);
    const fallbackClarification = buildFallbackClarification({
      workflowName,
      requirements,
      description,
      workingDirectory,
      referenceWorkflow,
    });

    if (draft) {
      const specCoding = applyAiSpecCodingDraft(baseSpecCoding, draft);
      const clarification = draft?.clarification && typeof draft.clarification === 'object'
        ? {
            summary: typeof draft.clarification.summary === 'string' ? draft.clarification.summary.trim() : fallbackClarification.summary,
            knownFacts: normalizeStringArray(draft.clarification.knownFacts, 12),
            missingFields: normalizeStringArray(draft.clarification.missingFields, 8),
            questions: normalizeStringArray(draft.clarification.questions, 8),
          }
        : fallbackClarification;

      return NextResponse.json({
        specCoding,
        clarification,
        configValidation: formatValidationIssuesForResponse(configValidation),
        fallback: false,
        raw: JSON.stringify(draft),
      });
    }

    const settings = await loadChatSettings();
    const enabledSkills = Object.entries(settings.skills || {})
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    const systemPrompt = await buildDashboardSystemPrompt(
      enabledSkills.includes('spec-coding')
        ? (enabledSkills.includes('aceharness-workflow-creator') ? enabledSkills : [...enabledSkills, 'aceharness-workflow-creator'])
        : [...enabledSkills, 'spec-coding', 'aceharness-workflow-creator']
    );

    const engineType = await getConfiguredEngine();
    const engine = await createEngine(engineType as EngineType);
    if (!engine) {
      return NextResponse.json({
        specCoding: baseSpecCoding,
        clarification: fallbackClarification,
        configValidation: formatValidationIssuesForResponse(configValidation),
      fallback: true,
    });
    }

    const chunks: string[] = [];
    engine.on('stream', (event: any) => {
      if (event.type === 'text') chunks.push(event.content);
    });

    const prompt = [
      '你正在把一段初始需求整理成正式计划草案。',
      '目标不是讨论系统机制，而是沉淀一套可以直接执行、可以继续迭代、也可以被人工审查的业务计划制品。',
      '请先吸收输入里的业务背景、工作目录和改造方向，再输出高质量计划结果。',
      '',
      `workflowName: ${workflowName}`,
      `filename: ${filename}`,
      `workingDirectory: ${workingDirectory}`,
      `workspaceMode: ${workspaceMode}`,
      description ? `description: ${description}` : '',
      requirements ? `requirements: ${requirements}` : '',
      referenceWorkflow ? `referenceWorkflow: ${referenceWorkflow}` : '',
      '',
      '当前配置骨架只用于帮助你理解上下文，不限制业务方案本身：',
      '```json',
      JSON.stringify(config, null, 2),
      '```',
      '',
      '请严格只输出一个 JSON 对象，不要输出解释。',
      '字段要求：',
      '- summary: string，计划摘要，说明这次计划要解决的业务问题和落地目标',
      '- goals: string[]',
      '- nonGoals: string[]',
      '- constraints: string[]',
      '- clarification.summary: string，需求澄清结论',
      '- clarification.knownFacts: string[]，当前已确认信息',
      '- clarification.missingFields: string[]，仍缺失的信息',
      '- clarification.questions: string[]，下一步需要向用户确认的问题',
      '- artifacts.requirements: string，正式 requirements.md 内容（用户故事 + WHEN/THEN 验收标准）',
      '- artifacts.design: string，正式 design.md 内容（架构图 + 组件接口 + 关键决策）',
      '- artifacts.tasks: string，正式 tasks.md 内容（多级嵌套 checkbox + 需求追溯）',
      '',
      '要求：',
      '- 所有内容都用业务语言表达，聚焦业务目标、业务对象、业务规则、边界条件、验证标准和实施范围。',
      '- 先判断用户原始需求、补充说明和澄清回答的主语言；summary、clarification、requirements.md、design.md、tasks.md 必须统一使用该主语言。',
      '- 如果输入混合多种语言，以用户需求正文占比最高的语言为准；若用户最后明确指定语言，则以用户指定语言为准。文件名、代码、YAML key、API 名称、技术专名和产品名可以保留原文。',
      '- clarification 里的问题只问会改变业务方案的重要变量，不问系统机制、角色分工或配置实现。',
      '- requirements.md 必须包含：用户故事（作为<角色>，我希望<目标>，以便<价值>）+ WHEN/THEN 验收标准 + 术语表。',
      '- design.md 必须包含概述、Mermaid 架构图、组件接口与伪代码、关键决策表（选择/理由/替代方案）。',
      '- 只要 design 中出现 Mermaid 图，必须使用独立的 ```mermaid fenced code block；不要写成普通文本。',
      '- tasks.md 必须使用多级嵌套 checkbox 格式：顶层任务（- [ ] N. 标题）→ 子任务（  - [ ] N.M 标题）→ 步骤描述和需求引用（_需求：x.x_）。包含检查点任务。',
      '- 文档表面保持业务化，不直接写 workflow、agent、状态机等系统术语；但结构必须清晰到足以支撑后续 workflow 和角色分工派生。',
      '- 输出前先做一致性自检，确保 requirements/design/tasks 之间没有互相矛盾、越界执行或把假设写成事实的情况。',
      '- 如果信息仍有空缺，也要基于已知事实给出当前最佳草案，并把缺口整理进 clarification。',
    ].filter(Boolean).join('\n');

    const result = await engine.execute({
      agent: 'spec-coding',
      step: 'draft-spec-coding',
      prompt,
      systemPrompt,
      model: '',
      workingDirectory: process.cwd(),
    });
    engine.cancel();

    const raw = result.output || chunks.join('');
    const parsed = extractJsonObject(raw);
    const specCoding = parsed ? applyAiSpecCodingDraft(baseSpecCoding, parsed) : baseSpecCoding;
    const clarification = parsed?.clarification && typeof parsed.clarification === 'object'
      ? {
          summary: typeof parsed.clarification.summary === 'string' ? parsed.clarification.summary.trim() : fallbackClarification.summary,
          knownFacts: normalizeStringArray(parsed.clarification.knownFacts, 12),
          missingFields: normalizeStringArray(parsed.clarification.missingFields, 8),
          questions: normalizeStringArray(parsed.clarification.questions, 8),
        }
      : fallbackClarification;

    return NextResponse.json({
      specCoding,
      clarification,
      configValidation: formatValidationIssuesForResponse(configValidation),
      fallback: !parsed,
      raw,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '生成 SpecCoding AI 草案失败' },
      { status: 500 }
    );
  }
}
