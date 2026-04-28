import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { buildOpenSpecFromWorkflowConfig } from '@/lib/openspec-store';
import { buildDashboardSystemPrompt } from '@/lib/chat-system-prompt';
import { loadChatSettings } from '@/lib/chat-settings';
import { createEngine, getConfiguredEngine, type EngineType } from '@/lib/engines/engine-factory';
import type { OpenSpecDocument } from '@/lib/schemas';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/creator-validation';

function extractJsonObject(text: string): any | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const trimmed = candidate.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeStringArray(input: unknown, limit = 12): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function applyAiOpenSpecDraft(base: OpenSpecDocument, ai: any): OpenSpecDocument {
  const summary = typeof ai?.summary === 'string' && ai.summary.trim() ? ai.summary.trim() : base.summary;
  const goals = normalizeStringArray(ai?.goals, 8);
  const nonGoals = normalizeStringArray(ai?.nonGoals, 8);
  const constraints = normalizeStringArray(ai?.constraints, 12);
  const proposal = typeof ai?.artifacts?.proposal === 'string' ? ai.artifacts.proposal.trim() : '';
  const design = typeof ai?.artifacts?.design === 'string' ? ai.artifacts.design.trim() : '';
  const tasks = typeof ai?.artifacts?.tasks === 'string' ? ai.artifacts.tasks.trim() : '';
  const deltaSpec = typeof ai?.artifacts?.deltaSpec === 'string' ? ai.artifacts.deltaSpec.trim() : '';

  return {
    ...base,
    summary: summary || base.summary,
    goals: goals.length ? goals : base.goals,
    nonGoals: nonGoals.length ? nonGoals : base.nonGoals,
    constraints: constraints.length ? constraints : base.constraints,
    progress: {
      ...base.progress,
      summary: typeof ai?.clarification?.summary === 'string' && ai.clarification.summary.trim()
        ? ai.clarification.summary.trim()
        : base.progress.summary,
    },
    artifacts: {
      proposal: proposal || base.artifacts.proposal,
      design: design || base.artifacts.design,
      tasks: tasks || base.artifacts.tasks,
      deltaSpec: deltaSpec || base.artifacts.deltaSpec,
    },
  };
}

function buildFallbackClarification(input: {
  workflowName: string;
  requirements?: string;
  description?: string;
  workingDirectory: string;
  referenceWorkflow?: string;
}) {
  return {
    summary: '已根据当前输入整理业务背景，但仍需要补齐会直接影响业务方案、范围和验证方式的关键信息。',
    knownFacts: [
      input.workflowName ? `工作流名称：${input.workflowName}` : '',
      input.requirements ? `需求：${input.requirements}` : '',
      input.description ? `补充说明：${input.description}` : '',
      input.workingDirectory ? `工作目录：${input.workingDirectory}` : '',
      input.referenceWorkflow ? `参考工作流：${input.referenceWorkflow}` : '',
    ].filter(Boolean),
    missingFields: [
      '关键术语与对象定义',
      '业务结果边界',
      '覆盖范围与优先级',
      '兼容与验证约束',
    ],
    questions: [
      '有哪些关键术语、业务对象或边界概念需要先统一定义？',
      '最终希望业务问题被拆解成哪些可以直接执行和审查的结果？',
      '这次必须覆盖哪些业务对象、场景或能力，优先级如何？',
      '有哪些兼容性、风险边界或验证要求会直接改变方案设计？',
    ],
  };
}

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

    const baseOpenSpec = buildOpenSpecFromWorkflowConfig({
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
      const openSpec = applyAiOpenSpecDraft(baseOpenSpec, draft);
      const clarification = draft?.clarification && typeof draft.clarification === 'object'
        ? {
            summary: typeof draft.clarification.summary === 'string' ? draft.clarification.summary.trim() : fallbackClarification.summary,
            knownFacts: normalizeStringArray(draft.clarification.knownFacts, 12),
            missingFields: normalizeStringArray(draft.clarification.missingFields, 8),
            questions: normalizeStringArray(draft.clarification.questions, 8),
          }
        : fallbackClarification;

      return NextResponse.json({
        openSpec,
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
      enabledSkills.includes('openspec') ? enabledSkills : [...enabledSkills, 'openspec']
    );

    const engineType = await getConfiguredEngine();
    const engine = await createEngine(engineType as EngineType);
    if (!engine) {
      return NextResponse.json({
        openSpec: baseOpenSpec,
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
      '- artifacts.proposal: string，正式 proposal.md 内容',
      '- artifacts.design: string，正式 design.md 内容',
      '- artifacts.tasks: string，正式 tasks.md 内容',
      '- artifacts.deltaSpec: string，正式 spec.md / delta spec 内容',
      '',
      '要求：',
      '- 所有内容都用业务语言表达，聚焦业务目标、业务对象、业务规则、边界条件、验证标准和实施范围。',
      '- 先判断用户原始需求、补充说明和澄清回答的主语言；summary、clarification、proposal.md、design.md、tasks.md、spec.md/deltaSpec 必须统一使用该主语言。',
      '- 如果输入混合多种语言，以用户需求正文占比最高的语言为准；若用户最后明确指定语言，则以用户指定语言为准。文件名、代码、YAML key、API 名称、技术专名和产品名可以保留原文。',
      '- clarification 里的问题只问会改变业务方案的重要变量，不问系统机制、角色分工或配置实现。',
      '- proposal 必须写清楚业务目标、当前问题、范围、非范围、验收标准、需求切片，以及已确认事实 / 当前假设 / 待确认点。',
      '- design 必须包含 Overview、Architecture、Core Components、Data Models、Interfaces And Contracts、业务流程图或 Mermaid 图，以及能落到真实逻辑的伪代码或步骤化算法说明。',
      '- 只要 design 中出现 Mermaid 图，必须使用独立的 ```mermaid fenced code block；不要写成“Mermaid 流程图如下：flowchart ...”这类普通文本。',
      '- tasks 必须足够细，按阶段拆分；每项都写清楚关联需求、关联设计、任务类型、目标、输入/依赖、实施内容、产物和验证方式。',
      '- requirements/spec 应尽量使用稳定的需求 DSL：术语表 + 可编号需求 + 场景/验收标准。',
      '- 文档表面保持业务化，不直接写 workflow、agent、状态机等系统术语；但结构必须清晰到足以支撑后续 workflow 和角色分工派生。',
      '- 输出前先做一致性自检，确保 requirements/design/tasks 之间没有互相矛盾、越界执行或把假设写成事实的情况。',
      '- deltaSpec 只写对外行为契约和业务场景，不写实现细节。',
      '- 如果信息仍有空缺，也要基于已知事实给出当前最佳草案，并把缺口整理进 clarification。',
    ].filter(Boolean).join('\n');

    const result = await engine.execute({
      agent: 'openspec',
      step: 'draft-openspec',
      prompt,
      systemPrompt,
      model: '',
      workingDirectory: process.cwd(),
    });
    engine.cancel();

    const raw = result.output || chunks.join('');
    const parsed = extractJsonObject(raw);
    const openSpec = parsed ? applyAiOpenSpecDraft(baseOpenSpec, parsed) : baseOpenSpec;
    const clarification = parsed?.clarification && typeof parsed.clarification === 'object'
      ? {
          summary: typeof parsed.clarification.summary === 'string' ? parsed.clarification.summary.trim() : fallbackClarification.summary,
          knownFacts: normalizeStringArray(parsed.clarification.knownFacts, 12),
          missingFields: normalizeStringArray(parsed.clarification.missingFields, 8),
          questions: normalizeStringArray(parsed.clarification.questions, 8),
        }
      : fallbackClarification;

    return NextResponse.json({
      openSpec,
      clarification,
      configValidation: formatValidationIssuesForResponse(configValidation),
      fallback: !parsed,
      raw,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '生成 OpenSpec AI 草案失败' },
      { status: 500 }
    );
  }
}
