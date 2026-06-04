import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
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

export { extractJsonObject, normalizeStringArray, applyAiSpecCodingDraft, buildFallbackClarification } from '@/lib/ai/draft-utils';

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
      '请根据下面的工作流上下文生成一个结构化的 SpecCoding 草案。',
      '输出必须是单个 JSON 对象，不要输出解释。',
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
      'JSON 顶层至少包含这些字段：',
      '- summary: string',
      '- goals: string[]',
      '- nonGoals: string[]',
      '- constraints: string[]',
      '- clarification.summary: string',
      '- clarification.knownFacts: string[]',
      '- clarification.missingFields: string[]',
      '- clarification.questions: string[]',
      '- artifacts.requirements: string',
      '- artifacts.design: string',
      '- artifacts.tasks: string',
      '',
      '要求：',
      '- requirements/design/tasks 三份文档内容彼此一致。',
      '- requirements 使用正式的 requirements.md 风格。',
      '- design 使用正式的 design.md 风格；若包含 Mermaid，必须使用 ```mermaid fenced code block。',
      '- tasks 使用多级 checkbox 的 tasks.md 风格。',
      '- 如果信息不足，也要先给出当前最佳草案，并把缺口写入 clarification。',
    ].filter(Boolean).join('\n');

    const result = await executeEngineWithContextRecovery(engine, {
      agent: 'spec-coding',
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
