import { NextRequest, NextResponse } from 'next/server';
import { createEngine, getConfiguredEngine, type EngineType } from '@/lib/engines/engine-factory';
import { loadChatSettings } from '@/lib/chat-settings';
import { buildDashboardSystemPrompt } from '@/lib/chat-system-prompt';
import { createDeterministicAvatarConfig } from '@/lib/agent-personas';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import {
  buildWorkflowExperiencePromptBlock,
  findRelevantWorkflowExperiences,
} from '@/lib/workflow-experience-store';
import {
  buildMemoryPromptBlock,
  listMemoryEntries,
} from '@/lib/workflow-memory-store';
import { getRuntimeConfigsDirPath } from '@/lib/runtime-configs';
import { listAgentRelationships } from '@/lib/agent-relationship-store';
import { formatValidationIssuesForResponse, validateAgentDraft } from '@/lib/creator-validation';

type AgentDraftRecommendation = {
  experiences: Array<{
    runId: string;
    workflowName?: string;
    configFile: string;
    summary: string;
  }>;
  referenceWorkflow: null | {
    filename: string;
    name?: string;
    description?: string;
    projectRoot?: string;
    agents: string[];
    phases: string[];
    states: string[];
  };
  relationshipHints: Array<{
    agent: string;
    counterpart: string;
    synergyScore: number;
    strengths: string[];
  }>;
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `agent-${Date.now()}`;
}

function fallbackDraft(input: {
  displayName: string;
  team?: string;
  mission: string;
  style?: string;
  specialties?: string;
  engine?: string;
  model?: string;
}) {
  const keywords = (input.specialties || '')
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    name: slugify(input.displayName),
    team: ['blue', 'red', 'judge', 'yellow', 'black-gold'].includes(input.team || '') ? input.team : 'blue',
    roleType: input.team === 'black-gold' ? 'supervisor' : 'normal',
    avatar: createDeterministicAvatarConfig(input.displayName, {
      team: (['blue', 'red', 'judge', 'yellow', 'black-gold'].includes(input.team || '') ? input.team : 'blue') as any,
      roleType: input.team === 'black-gold' ? 'supervisor' : 'normal',
    }),
    engineModels: input.engine && input.model ? { [input.engine]: input.model } : {},
    activeEngine: input.engine || '',
    capabilities: keywords.length > 0 ? keywords : [input.mission],
    systemPrompt: [
      `你是 ${input.displayName}，这是你在 ACEHarness 中的角色身份。`,
      '',
      '你的工作目标：',
      input.mission,
      '',
      `你的沟通风格：${input.style || '专业、直接、可靠'}`,
      '',
      '回答时保持清晰、务实、可执行。',
    ].join('\n'),
    description: input.mission,
    keywords,
    tags: ['AI创建', input.style || '默认风格'].filter(Boolean),
    category: '首页创建',
  };
}

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

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('无效工作流文件名');
  }
  return normalized;
}

function collectWorkflowAgents(referenceConfig: any): string[] {
  const names = new Set<string>();
  const phases = Array.isArray(referenceConfig?.workflow?.phases) ? referenceConfig.workflow.phases : [];
  const states = Array.isArray(referenceConfig?.workflow?.states) ? referenceConfig.workflow.states : [];

  for (const phase of phases) {
    for (const step of phase?.steps || []) {
      if (typeof step?.agent === 'string' && step.agent.trim()) names.add(step.agent.trim());
    }
  }
  for (const state of states) {
    for (const step of state?.steps || []) {
      if (typeof step?.agent === 'string' && step.agent.trim()) names.add(step.agent.trim());
    }
  }
  return Array.from(names);
}

function buildReferenceWorkflowPromptBlock(input: {
  referenceWorkflow?: string;
  referenceConfig?: any;
  relationshipHints: string[];
}): string {
  if (!input.referenceWorkflow || !input.referenceConfig) return '';

  const workflow = input.referenceConfig.workflow || {};
  const context = input.referenceConfig.context || {};
  const agentNames = collectWorkflowAgents(input.referenceConfig);
  const phaseNames = Array.isArray(workflow.phases) ? workflow.phases.map((phase: any) => phase?.name).filter(Boolean) : [];
  const stateNames = Array.isArray(workflow.states) ? workflow.states.map((state: any) => state?.name).filter(Boolean) : [];

  return [
    '## 参考工作流',
    `- 文件: ${input.referenceWorkflow}`,
    workflow.name ? `- 名称: ${workflow.name}` : '',
    workflow.description ? `- 描述: ${workflow.description}` : '',
    context.projectRoot ? `- 工程目录: ${context.projectRoot}` : '',
    phaseNames.length ? `- 阶段: ${phaseNames.slice(0, 6).join('、')}` : '',
    stateNames.length ? `- 状态: ${stateNames.slice(0, 6).join('、')}` : '',
    agentNames.length ? `- 已有角色: ${agentNames.slice(0, 10).join('、')}` : '',
    input.relationshipHints.length ? '- 相关协作关系:' : '',
    ...input.relationshipHints.map((line) => `  - ${line}`),
    '- 要求: 如果当前要创建的 Agent 与参考工作流中的角色职责接近，请复用其分工风格、命名粒度和能力边界；如果是补位角色，请避免与现有角色重复。',
  ].filter(Boolean).join('\n');
}

function buildDraftRecommendations(input: {
  relatedExperiences: Awaited<ReturnType<typeof findRelevantWorkflowExperiences>>;
  referenceWorkflow?: string;
  referenceConfig?: any;
  relationshipEntries: Array<{
    agent: string;
    counterpart: string;
    synergyScore: number;
    strengths: string[];
  }>;
}): AgentDraftRecommendation {
  const workflow = input.referenceConfig?.workflow || {};
  const context = input.referenceConfig?.context || {};

  return {
    experiences: input.relatedExperiences.slice(0, 3).map((entry) => ({
      runId: entry.runId,
      workflowName: entry.workflowName,
      configFile: entry.configFile,
      summary: entry.summary,
    })),
    referenceWorkflow: input.referenceWorkflow && input.referenceConfig ? {
      filename: input.referenceWorkflow,
      name: typeof workflow.name === 'string' ? workflow.name : undefined,
      description: typeof workflow.description === 'string' ? workflow.description : undefined,
      projectRoot: typeof context.projectRoot === 'string' ? context.projectRoot : undefined,
      agents: collectWorkflowAgents(input.referenceConfig).slice(0, 10),
      phases: Array.isArray(workflow.phases)
        ? workflow.phases.map((phase: any) => phase?.name).filter((value: unknown): value is string => typeof value === 'string').slice(0, 8)
        : [],
      states: Array.isArray(workflow.states)
        ? workflow.states.map((state: any) => state?.name).filter((value: unknown): value is string => typeof value === 'string').slice(0, 8)
        : [],
    } : null,
    relationshipHints: input.relationshipEntries.slice(0, 8),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const displayName = String(body.displayName || '').trim();
    const mission = String(body.mission || '').trim();
    const style = String(body.style || '').trim();
    const specialties = String(body.specialties || '').trim();
    const team = String(body.team || 'blue').trim();
    const workingDirectory = String(body.workingDirectory || '').trim();
    const referenceWorkflow = String(body.referenceWorkflow || '').trim();
    const requestedEngine = (body.engine || '') as EngineType | '';
    const requestedModel = String(body.model || '').trim();

    if (!displayName || !mission) {
      return NextResponse.json({ error: 'displayName 和 mission 不能为空' }, { status: 400 });
    }

    const settings = await loadChatSettings();
    const enabledSkills = Object.entries(settings.skills || {})
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    const systemPrompt = await buildDashboardSystemPrompt(enabledSkills);
    const relatedExperiences = await findRelevantWorkflowExperiences({
      requirements: [mission, specialties].filter(Boolean).join('\n'),
      projectRoot: workingDirectory || undefined,
      workflowName: displayName,
      limit: 3,
    }).catch(() => []);
    const projectMemories = workingDirectory
      ? await listMemoryEntries({
          scope: 'project',
          key: workingDirectory,
          limit: 3,
        }).catch(() => [])
      : [];
    let referenceConfig: any = null;
    if (referenceWorkflow) {
      try {
        const referencePath = resolve(await getRuntimeConfigsDirPath(), normalizeConfigFilename(referenceWorkflow));
        const referenceRaw = await readFile(referencePath, 'utf-8');
        referenceConfig = parse(referenceRaw);
      } catch {
        referenceConfig = null;
      }
    }
    const referenceAgents = referenceConfig ? collectWorkflowAgents(referenceConfig).slice(0, 6) : [];
    const relationshipEntries = (await Promise.all(
      referenceAgents.map(async (agentName) => {
        const relations = await listAgentRelationships(agentName, 3).catch(() => []);
        return relations
          .filter((item) => referenceAgents.includes(item.counterpart))
          .slice(0, 2)
          .map((item) => ({
            agent: agentName,
            counterpart: item.counterpart,
            synergyScore: item.synergyScore,
            strengths: item.strengths.slice(0, 2),
          }));
      })
    )).flat();
    const experienceBlock = buildWorkflowExperiencePromptBlock(relatedExperiences, '与当前角色职责相关的历史经验');
    const projectMemoryBlock = buildMemoryPromptBlock('当前工程的项目记忆', projectMemories, { maxItems: 3 });
    const referenceWorkflowBlock = buildReferenceWorkflowPromptBlock({
      referenceWorkflow,
      referenceConfig,
      relationshipHints: Array.from(new Set(
        relationshipEntries.map((item) => (
          `${item.agent} <-> ${item.counterpart} 协作倾向 ${item.synergyScore >= 0 ? '+' : ''}${item.synergyScore}${item.strengths.length ? `，强项：${item.strengths.join('；')}` : ''}`
        ))
      )).slice(0, 8),
    });
    const recommendations = buildDraftRecommendations({
      relatedExperiences,
      referenceWorkflow,
      referenceConfig,
      relationshipEntries,
    });

    const prompt = [
      '请为以下需求生成一个 ACEHarness Agent 配置草案。',
      '',
      `显示名称: ${displayName}`,
      `建议队伍: ${team}`,
      `职责: ${mission}`,
      `风格: ${style || '专业、直接、可靠'}`,
      `擅长领域: ${specialties || '未指定'}`,
      workingDirectory ? `工作目录: ${workingDirectory}` : '',
      referenceWorkflow ? `参考工作流: ${referenceWorkflow}` : '',
      experienceBlock,
      projectMemoryBlock,
      referenceWorkflowBlock,
      '',
      '请严格只输出一个 JSON 对象，不要输出解释。',
      'JSON 字段要求：',
      '- name: kebab-case，适合作为文件名',
      '- team: blue/red/judge/yellow/black-gold',
      '- roleType: normal/supervisor',
      '- avatar: 使用 AgentAvatarConfig 结构；默认 mode=deterministic，并填写 seed/style',
      '- engineModels: object',
      '- activeEngine: string',
      '- capabilities: string[]',
      '- systemPrompt: string',
      '- description: string',
      '- keywords: string[]',
      '- tags: string[]',
      '- category: string',
      '',
      '注意：',
      '- 阵营视觉按 blue/red/yellow/black-gold 四个阵营理解；judge 仅表示裁定席职责位',
      '- 如果没有明确指定模型，可让 engineModels 为空对象，activeEngine 为空字符串',
      '- capabilities 至少一个',
      '- systemPrompt 要完整可用',
      '- 如果历史经验里已经出现适合复用的职责边界、约束、能力标签，请吸收进 capabilities / systemPrompt / tags',
      '- 如果提供了参考工作流，请吸收其中的角色粒度、协作分工和命名风格，并尽量避免与已有角色重复',
      '- 不要输出 markdown',
    ].join('\n');

    const engineType = requestedEngine || await getConfiguredEngine();
    const engine = await createEngine(engineType);
    if (!engine) {
      const draft = fallbackDraft({ displayName, team, mission, style, specialties, engine: requestedEngine, model: requestedModel });
      const validation = validateAgentDraft(draft);
      return NextResponse.json({
        draft: validation.normalized || draft,
        raw: JSON.stringify(draft, null, 2),
        fallback: true,
        experienceHints: relatedExperiences,
        recommendations,
        validation: formatValidationIssuesForResponse(validation),
      });
    }

    const chunks: string[] = [];
    engine.on('stream', (event: any) => {
      if (event.type === 'text') chunks.push(event.content);
    });

    const result = await engine.execute({
      agent: 'agent-creator',
      step: 'draft-agent',
      prompt,
      systemPrompt,
      model: requestedModel,
      workingDirectory: process.cwd(),
    });

    engine.cancel();

    const raw = result.output || chunks.join('');
    const parsed = extractJsonObject(raw);
    const draft = parsed && typeof parsed === 'object'
      ? {
          ...fallbackDraft({ displayName, team, mission, style, specialties, engine: requestedEngine, model: requestedModel }),
          ...parsed,
        }
      : fallbackDraft({ displayName, team, mission, style, specialties, engine: requestedEngine, model: requestedModel });

    if (!draft.name) draft.name = slugify(displayName);
    if (!draft.avatar || typeof draft.avatar !== 'object') {
      draft.avatar = createDeterministicAvatarConfig(displayName, {
        team: draft.team || 'blue',
        roleType: draft.roleType || 'normal',
      });
    }
    if (!draft.capabilities || !Array.isArray(draft.capabilities) || draft.capabilities.length === 0) {
      draft.capabilities = [mission];
    }
    if (!draft.systemPrompt || typeof draft.systemPrompt !== 'string') {
      draft.systemPrompt = fallbackDraft({ displayName, team, mission, style, specialties, engine: requestedEngine, model: requestedModel }).systemPrompt;
    }
    if (!draft.engineModels || typeof draft.engineModels !== 'object') draft.engineModels = {};
    if (typeof draft.activeEngine !== 'string') draft.activeEngine = requestedEngine || '';
    if (draft.team === 'black-gold' && !draft.roleType) draft.roleType = 'supervisor';
    if (!draft.description) draft.description = mission;

    const validation = validateAgentDraft(draft);

    return NextResponse.json({
      draft: validation.normalized || draft,
      raw,
      experienceHints: relatedExperiences,
      recommendations,
      validation: formatValidationIssuesForResponse(validation),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '生成 Agent 草案失败' },
      { status: 500 },
    );
  }
}
