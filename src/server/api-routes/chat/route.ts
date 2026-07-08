import { createEngine, resolveRequestedEngineType } from '@/lib/engines/engine-factory';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import {
  buildChatRequestContext,
  ensureEngineRuntimeSkillsAvailable,
  type RequestedMcpServersInput,
  type RequestedSkillsInput,
} from '@/lib/chat/request-options';
import { executeEngineWithContextRecovery, resolveRecoveredSessionId } from '@/lib/engines/context-recovery';
import { requireAuth } from '@/lib/auth/middleware';
import { normalizeEngineNamespacedSlashCommand } from '@/lib/chat/engine-slash-command';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const maxDuration = 1200;

export async function POST(request: Request) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
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
    } = body;

    if (!message?.trim()) {
      return jsonError('消息不能为空', 400);
    }

    const useModel = model || '';
    const { systemPrompt, resolvedWorkingDirectory, runtimeSkillNames, enabledMcpServers, runtimeDatabaseEnv } = await buildChatRequestContext({
      mode,
      sessionId,
      frontendSessionId,
      workingDirectory,
      extraSystemPrompt,
      requestedSkills: skills as RequestedSkillsInput,
      requestedMcpServers: mcpServers as RequestedMcpServersInput,
      personalDir: auth?.personalDir,
    });

    const engineType = await resolveRequestedEngineType(requestedEngine);
    const engineCommand = normalizeEngineNamespacedSlashCommand(message, engineType);
    const engine = await createEngine(engineType);

    if (!engine) {
      return jsonError('引擎不可用，请检查配置', 500);
    }

    await ensureEngineRuntimeSkillsAvailable(engineType, resolvedWorkingDirectory || getWorkspaceRoot(), runtimeSkillNames);

    const chunks: string[] = [];
    engine.on('stream', (event: any) => {
      if (event.type === 'text') chunks.push(event.content);
    });

    const result = await executeEngineWithContextRecovery(engine, {
        agent: 'chat',
        step: 'chat',
        prompt: engineCommand.prompt,
        systemPrompt,
        model: useModel,
        workingDirectory: resolvedWorkingDirectory || getWorkspaceRoot(),
        sessionId: sessionId || undefined,
        mcpServers: enabledMcpServers,
        userId: auth?.id,
        rawPrompt: engineCommand.rawPrompt,
        env: runtimeDatabaseEnv,
    });

    return jsonOk({
      result: result.output || chunks.join(''),
      sessionId: resolveRecoveredSessionId(result, sessionId),
      engine: engineType,
      isError: !result.success,
      error: result.error || undefined,
    });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '执行失败', 500);
  }
}
