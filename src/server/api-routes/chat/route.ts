import { getWorkspaceRoot } from '@/lib/core/app-paths';
import {
  buildChatRequestContext,
  ensureEngineRuntimeSkillsAvailable,
  type RequestedMcpServersInput,
  type RequestedSkillsInput,
} from '@/lib/chat/request-options';
import {
  createChatRuntimeEngine,
  executeChatRuntimeWithContextRecovery,
  resolveRecoveredRuntimeSessionId,
  resolveRequestedChatRuntimeEngineType,
  resolveRequestedChatRuntimeModel,
  type ChatRuntimeResultMetadata,
  type ChatRuntimeTokenUsage,
} from '@/lib/chat/chat-engine-runtime';
import { requireAuth } from '@/lib/auth/middleware';
import { normalizeEngineNamespacedSlashCommand } from '@/lib/chat/engine-slash-command';
import {
  buildMemoryV2RecoverySource,
  prepareHomepageChatMemoryV2,
} from '@/lib/memory-v2-cutover/homepage-chat';
import { AiMemoryV2EngineAdapter } from '@/lib/agent/ai-memory-engine-adapter';
import { chatModelRouteError, resolveActiveChatModelRoute } from '@/lib/chat/model-route-validation';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const maxDuration = 1200;

function numberOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeUsage(metadata?: ChatRuntimeResultMetadata): Partial<ChatRuntimeTokenUsage> | undefined {
  const usage = metadata?.usage;
  if (!usage) return undefined;
  const input = numberOrUndefined((usage as any).input_tokens ?? (usage as any).inputTokens);
  const output = numberOrUndefined((usage as any).output_tokens ?? (usage as any).outputTokens);
  const cacheCreation = numberOrUndefined((usage as any).cache_creation_input_tokens ?? (usage as any).cacheCreationInputTokens);
  const cacheRead = numberOrUndefined((usage as any).cache_read_input_tokens ?? (usage as any).cacheReadInputTokens);
  const values = [input, output, cacheCreation, cacheRead].filter((value): value is number => value !== undefined);
  if (values.length === 0 || values.every((value) => value === 0)) {
    return undefined;
  }
  return {
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    ...(cacheCreation !== undefined ? { cache_creation_input_tokens: cacheCreation } : {}),
    ...(cacheRead !== undefined ? { cache_read_input_tokens: cacheRead } : {}),
  };
}

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
      sessionId: requestedSessionId,
      runtimeSessionId,
      frontendSessionId,
      mode,
      workingDirectory,
      extraSystemPrompt,
      skills,
      mcpServers,
      creationAssistantEnabled,
    } = body;

    if (!message?.trim()) {
      return jsonError('消息不能为空', 400);
    }

    const sessionId = typeof runtimeSessionId === 'string' && runtimeSessionId.trim()
      ? runtimeSessionId.trim()
      : (typeof requestedSessionId === 'string' ? requestedSessionId.trim() : '');

    const engineType = await resolveRequestedChatRuntimeEngineType(requestedEngine);
    const useModel = resolveRequestedChatRuntimeModel(model);
    if (useModel && !resolveActiveChatModelRoute(engineType, useModel)) {
      return jsonError(chatModelRouteError(engineType, useModel), 422);
    }
    const { systemPrompt, resolvedWorkingDirectory, runtimeSkillNames, enabledMcpServers, runtimeDatabaseEnv } = await buildChatRequestContext({
      mode,
      sessionId,
      frontendSessionId,
      workingDirectory,
      extraSystemPrompt,
      requestedSkills: skills as RequestedSkillsInput,
      requestedMcpServers: mcpServers as RequestedMcpServersInput,
      creationAssistantEnabled: typeof creationAssistantEnabled === 'boolean'
        ? creationAssistantEnabled
        : undefined,
      personalDir: auth?.personalDir,
    });
    const preparedMemoryV2 = await prepareHomepageChatMemoryV2({
      ownerUserId: auth.id,
      frontendSessionId: typeof frontendSessionId === 'string' ? frontendSessionId : undefined,
      message,
    });

    const engineCommand = normalizeEngineNamespacedSlashCommand(message, engineType);
    const engine = await createChatRuntimeEngine(engineType);

    if (!engine) {
      return jsonError('引擎不可用，请检查配置', 500);
    }

    await ensureEngineRuntimeSkillsAvailable(engineType, resolvedWorkingDirectory || getWorkspaceRoot(), runtimeSkillNames);

    const memoryEngine = new AiMemoryV2EngineAdapter(
      engine,
      (options) => options.step === 'chat',
      preparedMemoryV2.plan,
      preparedMemoryV2.memoryV2,
    );
    const chunks: string[] = [];
    const onMemoryEngineStream = (event: any) => {
      if (event.type === 'text') chunks.push(event.content);
    };
    memoryEngine.on('stream', onMemoryEngineStream);

    try {
      const result = await executeChatRuntimeWithContextRecovery(memoryEngine, {
        agent: 'chat',
        step: 'chat',
        prompt: engineCommand.prompt,
        systemPrompt,
        model: useModel,
        workingDirectory: resolvedWorkingDirectory || getWorkspaceRoot(),
        sessionId: sessionId || undefined,
        mcpServers: enabledMcpServers,
        userId: auth.id,
        rawPrompt: engineCommand.rawPrompt,
        env: runtimeDatabaseEnv,
      }, {
        buildCompactSource: () => buildMemoryV2RecoverySource({
          promptBlock: memoryEngine.getLatestMemoryV2PromptBlock(),
          currentRequest: engineCommand.prompt,
        }),
      });

      const runtimeSessionId = resolveRecoveredRuntimeSessionId(result, sessionId);
      return jsonOk({
        result: result.output || chunks.join(''),
        runtimeSessionId,
        sessionId: runtimeSessionId,
        engine: engineType,
        usage: normalizeUsage(result.metadata),
        costUsd: result.metadata?.costUsd ?? result.metadata?.cost_usd,
        durationMs: result.metadata?.durationMs ?? result.metadata?.duration_ms,
        isError: !result.success,
        error: result.error || undefined,
      });
    } finally {
      memoryEngine.off('stream', onMemoryEngineStream);
      memoryEngine.releaseMemoryV2();
    }
  } catch (error: any) {
    return jsonError(errorMessage(error) || '执行失败', 500);
  }
}
