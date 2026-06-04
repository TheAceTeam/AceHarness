import { NextRequest, NextResponse } from 'next/server';
import { createEngine, resolveRequestedEngineType } from '@/lib/engines/engine-factory';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import {
  buildChatRequestContext,
  ensureEngineRuntimeSkillsAvailable,
  type RequestedMcpServersInput,
  type RequestedSkillsInput,
} from '@/lib/chat/request-options';
import { executeEngineWithContextRecovery, resolveRecoveredSessionId } from '@/lib/engines/context-recovery';

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
      mcpServers,
    } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const useModel = model || '';
    const { systemPrompt, runtimeSkillNames, enabledMcpServers } = await buildChatRequestContext({
      mode,
      sessionId,
      frontendSessionId,
      workingDirectory,
      extraSystemPrompt,
      requestedSkills: skills as RequestedSkillsInput,
      requestedMcpServers: mcpServers as RequestedMcpServersInput,
    });

    const engineType = await resolveRequestedEngineType(requestedEngine);
    const engine = await createEngine(engineType);

    if (!engine) {
      return NextResponse.json({ error: '引擎不可用，请检查配置' }, { status: 500 });
    }

    await ensureEngineRuntimeSkillsAvailable(engineType, getWorkspaceRoot(), runtimeSkillNames);

    const chunks: string[] = [];
    engine.on('stream', (event: any) => {
      if (event.type === 'text') chunks.push(event.content);
    });

    const result = await executeEngineWithContextRecovery(engine, {
        agent: 'chat',
        step: 'chat',
        prompt: message,
        systemPrompt,
        model: useModel,
        workingDirectory: getWorkspaceRoot(),
        sessionId: sessionId || undefined,
        mcpServers: enabledMcpServers,
    });

    return NextResponse.json({
      result: result.output || chunks.join(''),
      sessionId: resolveRecoveredSessionId(result, sessionId),
      engine: engineType,
      isError: !result.success,
      error: result.error || undefined,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || '执行失败' },
      { status: 500 }
    );
  }
}
