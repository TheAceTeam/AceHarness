import { NextRequest, NextResponse } from 'next/server';
import { createEngine, resolveRequestedEngineType } from '@/lib/engines/engine-factory';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { buildChatRequestContext, ensureEngineRuntimeSkillsAvailable, type RequestedSkillsInput } from '@/lib/chat/request-options';
import { recordModelProbeObservation } from '@/lib/models/probes';

const CHAT_TIMEOUT_MS = 20 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const {
      message,
      model,
      engine: requestedEngine,
      sessionId,
      frontendSessionId,
      mode,
      workingDirectory,
      extraSystemPrompt,
      skills,
    } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const useModel = model || '';
    const { systemPrompt } = await buildChatRequestContext({
      mode,
      sessionId,
      frontendSessionId,
      workingDirectory,
      extraSystemPrompt,
      requestedSkills: skills as RequestedSkillsInput,
    });

    const engineType = await resolveRequestedEngineType(requestedEngine);
    const engine = await createEngine(engineType);

    if (!engine) {
      void recordModelProbeObservation({
        engine: engineType,
        model: useModel,
        success: false,
        source: 'chat',
        engineAvailable: false,
        error: '引擎不可用，请检查配置',
      }).catch(() => {});
      return NextResponse.json({ error: '引擎不可用，请检查配置' }, { status: 500 });
    }

    await ensureEngineRuntimeSkillsAvailable(engineType, getWorkspaceRoot());

    const chunks: string[] = [];
    engine.on('stream', (event: any) => {
      if (event.type === 'text') chunks.push(event.content);
    });

    const executeStartedAt = Date.now();
    const result = await new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        engine.cancel();
        reject(new Error(`聊天请求超过 ${CHAT_TIMEOUT_MS / 60000} 分钟，已自动销毁`));
      }, CHAT_TIMEOUT_MS);

      engine.execute({
        agent: 'chat',
        step: 'chat',
        prompt: message,
        systemPrompt,
        model: useModel,
        workingDirectory: getWorkspaceRoot(),
        sessionId: sessionId || undefined,
      })
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timeoutId));
    }).catch((error) => {
      void recordModelProbeObservation({
        engine: engineType,
        model: useModel,
        success: false,
        source: 'chat',
        responseLatencyMs: Date.now() - executeStartedAt,
        totalDurationMs: Date.now() - executeStartedAt,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
      throw error;
    });

    void recordModelProbeObservation({
      engine: engineType,
      model: typeof result.metadata?.resolvedModel === 'string' ? result.metadata.resolvedModel : useModel,
      success: Boolean(result.success),
      source: 'chat',
      responseLatencyMs: Date.now() - executeStartedAt,
      totalDurationMs: Date.now() - executeStartedAt,
      outputPreview: result.output || chunks.join(''),
      error: result.success ? undefined : (result.error || '聊天请求返回异常状态'),
    }).catch(() => {});

    // Brief delay to allow final stream events to flush before cleanup
    await new Promise(r => setTimeout(r, 1000));
    engine.cancel();

    return NextResponse.json({
      result: result.output || chunks.join(''),
      sessionId: result.sessionId,
      engine: engineType,
      isError: !result.success,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || '执行失败' },
      { status: 500 }
    );
  }
}
