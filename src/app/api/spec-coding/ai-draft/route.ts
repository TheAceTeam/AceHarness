import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { readFile } from 'fs/promises';
import {
  buildSpecCodingFromWorkflowConfig,
  loadMasterSpecAsCreationSession,
  rebuildSpecCodingPreservingArtifacts,
} from '@/lib/spec/coding-store';
import { buildDashboardSystemPrompt } from '@/lib/chat/system-prompt';
import { loadChatSettings } from '@/lib/chat/settings';
import { createEngine, getConfiguredEngine, type EngineType } from '@/lib/engines/engine-factory';
import { executeEngineWithContextRecovery } from '@/lib/engines/context-recovery';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/core/creator-validation';
import {
  extractJsonObject,
  normalizeStringArray,
  applyAiSpecCodingDraft,
  buildFallbackClarification,
} from '@/lib/ai/draft-utils';
import { assertPersistedSpecRootReady } from '@/lib/spec/persistence';
import { getRuntimeSkillPath } from '@/lib/run/runtime-skills';
import { validateSpecArtifactsQuality } from '@/lib/spec/artifact-quality';

export { extractJsonObject, normalizeStringArray, applyAiSpecCodingDraft, buildFallbackClarification } from '@/lib/ai/draft-utils';

async function readRuntimeSkillFile(skillName: string, fileName: string): Promise<string> {
  try {
    const filePath = await getRuntimeSkillPath(skillName, fileName);
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

async function buildSpecCodingInstructionBlock(): Promise<string> {
  const skillName = 'aceharness-spec-coding';
  const [skill, prompt, requirementsTemplate, designTemplate, tasksTemplate] = await Promise.all([
    readRuntimeSkillFile(skillName, 'SKILL.md'),
    readRuntimeSkillFile(skillName, 'PROMPT.md'),
    readRuntimeSkillFile(skillName, 'templates/requirements.md'),
    readRuntimeSkillFile(skillName, 'templates/design.md'),
    readRuntimeSkillFile(skillName, 'templates/tasks.md'),
  ]);
  return [
    '# aceharness-spec-coding/SKILL.md',
    skill,
    '',
    '# aceharness-spec-coding/PROMPT.md',
    prompt,
    '',
    '# templates/requirements.md',
    requirementsTemplate,
    '',
    '# templates/design.md',
    designTemplate,
    '',
    '# templates/tasks.md',
    tasksTemplate,
  ].filter((part) => part.trim()).join('\n\n');
}

function buildQualityPayload(specCoding: any) {
  return validateSpecArtifactsQuality(specCoding?.artifacts || {});
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
    const persistMode: 'repository' | 'none' = body.persistMode === 'repository' ? 'repository' : 'none';
    const specRoot = persistMode === 'repository' ? String(body.specRoot || '').trim() || '.spec' : undefined;
    const config = body.config;
    const draft = body.draft && typeof body.draft === 'object' ? body.draft : null;

    if (!workflowName || !filename || !workingDirectory || !config) {
      return NextResponse.json({ error: '缺少生成计划草案所需参数' }, { status: 400 });
    }

    const generatedBaseSpecCoding = buildSpecCodingFromWorkflowConfig({
      workflowName,
      description,
      requirements,
      filename,
      workspaceMode,
      workingDirectory,
      config,
    });

    let baseSpecCoding = {
      ...generatedBaseSpecCoding,
      persistMode,
      specRoot,
    };

    if (persistMode === 'repository') {
      const readySpecRoot = assertPersistedSpecRootReady(workingDirectory, specRoot);
      const masterSession = await loadMasterSpecAsCreationSession(workingDirectory, filename, specRoot);
      if (masterSession?.specCoding) {
        baseSpecCoding = {
          ...rebuildSpecCodingPreservingArtifacts({
            existing: masterSession.specCoding,
            workflowName,
            description,
            requirements,
            filename,
            workspaceMode,
            workingDirectory,
            config,
            status: masterSession.specCoding.status,
          }),
          persistMode,
          specRoot: readySpecRoot,
        };
      } else {
        baseSpecCoding = {
          ...baseSpecCoding,
          specRoot: readySpecRoot,
        };
      }
    }

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
      const qualityValidation = buildQualityPayload(specCoding);
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
        qualityValidation,
        fallback: false,
        raw: JSON.stringify(draft),
      });
    }

    const settings = await loadChatSettings();
    const enabledSkills = Object.entries(settings.skills || {})
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    const systemPrompt = await buildDashboardSystemPrompt(
      enabledSkills.includes('aceharness-spec-coding')
        ? (enabledSkills.includes('aceharness-workflow-creator') ? enabledSkills : [...enabledSkills, 'aceharness-workflow-creator'])
        : [...enabledSkills, 'aceharness-spec-coding', 'aceharness-workflow-creator']
    );

    const engineType = await getConfiguredEngine();
    const engine = await createEngine(engineType as EngineType);
    if (!engine) {
      const qualityValidation = buildQualityPayload(baseSpecCoding);
      return NextResponse.json({
        specCoding: baseSpecCoding,
        clarification: fallbackClarification,
        configValidation: formatValidationIssuesForResponse(configValidation),
        qualityValidation,
        fallback: true,
      });
    }

    const chunks: string[] = [];
    engine.on('stream', (event: any) => {
      if (event.type === 'text') chunks.push(event.content);
    });

    const specCodingInstructionBlock = await buildSpecCodingInstructionBlock();
    const prompt = [
      '请根据下面的工作流上下文生成一个结构化的 SpecCoding 草案。',
      '输出必须是单个 JSON 对象，不要输出解释。',
      '不要只填模板占位符，必须把需求、设计和任务拆到可执行粒度。',
      '',
      `workflowName: ${workflowName}`,
      `filename: ${filename}`,
      `workingDirectory: ${workingDirectory}`,
      `workspaceMode: ${workspaceMode}`,
      description ? `description: ${description}` : '',
      requirements ? `requirements: ${requirements}` : '',
      referenceWorkflow ? `referenceWorkflow: ${referenceWorkflow}` : '',
      '',
      '当前配置草稿如下：',
      '```json',
      JSON.stringify(config, null, 2),
      '```',
      '',
      '当前系统生成的基础 SpecCoding 草案如下，AI 输出必须不弱于它，并在此基础上细化：',
      '```json',
      JSON.stringify({
        summary: baseSpecCoding.summary,
        goals: baseSpecCoding.goals,
        nonGoals: baseSpecCoding.nonGoals,
        constraints: baseSpecCoding.constraints,
        artifacts: baseSpecCoding.artifacts,
      }, null, 2),
      '```',
      '',
      specCodingInstructionBlock ? [
        'aceharness-spec-coding 指令与模板：',
        '```markdown',
        specCodingInstructionBlock.slice(0, 24000),
        '```',
        '',
      ].join('\n') : '',
      '',
      'JSON 顶层至少包含这些字段：',
      '- summary: string',
      '- goals: string[]',
      '- nonGoals: string[]',
      '- constraints: string[]',
      '- revisionPlan: {artifact:"requirements"|"design"|"tasks", op:"add"|"modify"|"remove"|"rename", targetId:string, reason:string}[]',
      '- clarification.summary: string',
      '- clarification.knownFacts: string[]',
      '- clarification.missingFields: string[]',
      '- clarification.questions: string[]',
      '- artifacts.requirements: string',
      '- artifacts.design: string',
      '- artifacts.tasks: string',
      '',
      '要求：',
      '- requirements 必须包含简介、能力拆分、术语表、至少两个 R 编号需求块、用户故事、WHEN/THEN 验收标准、非目标和待确认项。',
      '- design 必须包含 Mermaid 架构/流程图、组件与接口、数据模型、数据流、关键决策 D 编号、测试方案、兼容性与风险。',
      '- tasks 必须使用多级 checkbox，所有可执行任务有 T 编号、需求追踪 R、设计追踪 D、动作、交付和验证方式。',
      '- revisionPlan 必须说明相对基础草案做了哪些 add/modify/remove/rename；即使是首版生成，也要列出新增、细化或收敛的内容。',
      '- requirements/design/tasks 三份文档内容彼此一致，且比基础草案更具体。',
      '- 如果信息不足，也要先给出当前最佳草案，并把缺口写入 clarification。',
    ].filter(Boolean).join('\n');

    const result = await executeEngineWithContextRecovery(engine, {
      agent: 'aceharness-spec-coding',
      step: 'draft-spec-coding',
      prompt,
      systemPrompt,
      model: '',
      workingDirectory: process.cwd(),
      userId: auth.id,
    });
    engine.cancel();

    const raw = result.output || chunks.join('');
    const parsed = extractJsonObject(raw);
    const aiSpecCoding = parsed ? applyAiSpecCodingDraft(baseSpecCoding, parsed) : baseSpecCoding;
    const aiQualityValidation = buildQualityPayload(aiSpecCoding);
    const specCoding = parsed && aiQualityValidation.ok ? aiSpecCoding : baseSpecCoding;
    const qualityValidation = parsed && aiQualityValidation.ok ? aiQualityValidation : buildQualityPayload(baseSpecCoding);
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
      qualityValidation,
      aiQualityValidation,
      fallback: !parsed || !aiQualityValidation.ok,
      raw,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '生成 SpecCoding AI 草案失败' },
      { status: 500 }
    );
  }
}
