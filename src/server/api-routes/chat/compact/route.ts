import { requireAuth } from '@/lib/auth/middleware';
import { loadChatSession } from '@/lib/chat/persistence';
import {
  buildChatRequestContext,
  ensureEngineRuntimeSkillsAvailable,
  type RequestedMcpServersInput,
  type RequestedSkillsInput,
} from '@/lib/chat/request-options';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { prepareAgentChat } from '@/lib/agent/chat-service';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import {
  compactChatRuntimeContextManually,
  createChatRuntimeEngine,
  resolveRequestedChatRuntimeEngineType,
} from '@/lib/chat/chat-engine-runtime';

const COMPACT_TIMEOUT_MS = 20 * 60 * 1000;
const COMPACT_SESSION_SEED = [
  '仅记录以上摘要作为本会话后续接力上下文。',
  '不要继续执行原任务，不要调用工具，不要读取或修改文件。',
  '回复一句“已完成上下文压缩”。',
].join('\n');

function isOwner(session: any, userId: string): boolean {
  if (!session) return false;
  if (!session.createdBy) return true;
  return session.createdBy === userId;
}

function formatMessageForCompact(message: any, index: number): string {
  const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'error' ? 'error' : 'user';
  const content = String(message?.rawContent || message?.content || '').trim();
  if (!content) return '';
  const meta = [
    `#${index + 1}`,
    role,
    message?.engine ? `engine=${message.engine}` : '',
    message?.model ? `model=${message.model}` : '',
    message?.timestamp ? `timestamp=${new Date(message.timestamp).toISOString()}` : '',
  ].filter(Boolean).join(' ');
  return `<message ${meta}>\n${content}\n</message>`;
}

function buildCompactSource(session: any, workingDirectory?: string): string {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return [
    '# Chat Session Transcript',
    '',
    `Frontend session ID: ${session?.id || ''}`,
    `Title: ${session?.title || ''}`,
    `Engine: ${session?.engine || ''}`,
    `Model: ${session?.model || ''}`,
    workingDirectory ? `Working directory: ${workingDirectory}` : '',
    session?.agentBinding ? `Agent binding: ${JSON.stringify(session.agentBinding)}` : '',
    session?.workflowBinding ? `Workflow binding: ${JSON.stringify(session.workflowBinding)}` : '',
    session?.creationSession ? `Creation binding: ${JSON.stringify(session.creationSession)}` : '',
    '',
    '# Messages',
    '',
    messages.map(formatMessageForCompact).filter(Boolean).join('\n\n'),
  ].filter((part) => part !== '').join('\n');
}

async function withTimeout<T>(promise: Promise<T>, onTimeout: () => void): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          onTimeout();
          reject(new Error(`上下文压缩超过 ${COMPACT_TIMEOUT_MS / 60000} 分钟，已自动取消`));
        }, COMPACT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  let engineToCancel: { cancel: () => void } | null = null;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const frontendSessionId = typeof body?.frontendSessionId === 'string' ? body.frontendSessionId.trim() : '';
    if (!frontendSessionId) {
      return jsonError('缺少前端会话 ID', 400);
    }

    const session = await loadChatSession(frontendSessionId);
    if (!session) {
      return jsonError('会话不存在', 404);
    }
    if (!isOwner(session, user.id)) {
      return jsonError('无权访问该会话', 403);
    }

    const compactSource = buildCompactSource(session, typeof body?.workingDirectory === 'string' ? body.workingDirectory : undefined);
    const requestedRuntimeSessionId = typeof body?.runtimeSessionId === 'string' && body.runtimeSessionId.trim()
      ? body.runtimeSessionId.trim()
      : typeof body?.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : (session.runtimeSessionId || undefined);
    const workflowBinding = session.workflowBinding;
    const agentBinding = session.agentBinding;
    const targetAgent = workflowBinding?.supervisorAgent || agentBinding?.agentName || '';

    if (targetAgent) {
      const prepared = await prepareAgentChat({
        agentName: targetAgent,
        message: COMPACT_SESSION_SEED,
        mode: workflowBinding?.supervisorAgent ? 'workflow-chat' : 'standalone-chat',
        sessionId: requestedRuntimeSessionId || workflowBinding?.supervisorSessionId || null,
        workingDirectory: typeof body?.workingDirectory === 'string' ? body.workingDirectory : undefined,
        workflowContext: workflowBinding?.supervisorAgent
          ? {
              configFile: workflowBinding.configFile,
              runId: workflowBinding.runId,
              supervisorAgent: workflowBinding.supervisorAgent,
              supervisorSessionId: workflowBinding.supervisorSessionId || null,
            }
          : null,
        userContext: {
          id: user.id,
          username: user.username,
          personalDir: user.personalDir,
        },
      });
      engineToCancel = prepared.engine;

      const compacted = await withTimeout(compactChatRuntimeContextManually(prepared.engine, {
        agent: prepared.roleConfig.name,
        step: 'manual-compact',
        prompt: COMPACT_SESSION_SEED,
        systemPrompt: prepared.roleConfig.systemPrompt || `你是 ${prepared.roleConfig.name}。`,
        model: prepared.model,
        workingDirectory: prepared.workingDirectory,
        allowedTools: prepared.roleConfig.allowedTools,
        sessionId: prepared.resumeSessionId || undefined,
        mcpServers: prepared.roleConfig.mcpServers,
        userId: prepared.userId,
      }, {
        buildCompactSource: () => compactSource,
        compactInstructions: 'This is a manual user-triggered /compact command. Focus on preserving enough state for future chat turns; do not invent completed work.',
      }), () => prepared.engine.cancel());

      const result = await withTimeout(prepared.engine.execute({
        agent: prepared.roleConfig.name,
        step: 'manual-compact-handoff',
        prompt: compacted.prompt,
        systemPrompt: prepared.roleConfig.systemPrompt || `你是 ${prepared.roleConfig.name}。`,
        model: prepared.model,
        workingDirectory: prepared.workingDirectory,
        allowedTools: [],
        forceNewSession: true,
        appendSystemPrompt: false,
        mcpServers: prepared.roleConfig.mcpServers,
        userId: prepared.userId,
      }), () => prepared.engine.cancel());

      if (!result.success && !result.sessionId) {
        throw new Error(result.error || '上下文压缩失败');
      }

      return jsonOk({
        ok: true,
        sessionId: result.sessionId || null,
        previousSessionId: requestedRuntimeSessionId || null,
        method: compacted.method,
        summary: compacted.summary,
        engine: prepared.engineType,
        model: prepared.model,
      });
    }

    const useModel = typeof body?.model === 'string' ? body.model : (session.model || '');
    const engineType = await resolveRequestedChatRuntimeEngineType(typeof body?.engine === 'string' ? body.engine : session.engine);
    const { systemPrompt, runtimeSkillNames, enabledMcpServers } = await buildChatRequestContext({
      mode: 'dashboard',
      frontendSessionId,
      workingDirectory: typeof body?.workingDirectory === 'string' ? body.workingDirectory : undefined,
      requestedSkills: body?.skills as RequestedSkillsInput,
      requestedMcpServers: body?.mcpServers as RequestedMcpServersInput,
      personalDir: user.personalDir,
    });
    await ensureEngineRuntimeSkillsAvailable(engineType, getWorkspaceRoot(), runtimeSkillNames);
    const engine = await createChatRuntimeEngine(engineType);
    if (!engine) {
      return jsonError('引擎不可用，请检查配置', 500);
    }
    engineToCancel = engine;

    const compacted = await withTimeout(compactChatRuntimeContextManually(engine, {
      agent: 'chat',
      step: 'manual-compact',
      prompt: COMPACT_SESSION_SEED,
      systemPrompt,
      model: useModel,
      workingDirectory: getWorkspaceRoot(),
      sessionId: requestedRuntimeSessionId,
      mcpServers: enabledMcpServers,
      userId: user.id,
    }, {
      buildCompactSource: () => compactSource,
      compactInstructions: 'This is a manual user-triggered /compact command. Preserve user intent, tool/action results, files, errors, and pending tasks for future chat turns.',
    }), () => engine.cancel());

    const result = await withTimeout(engine.execute({
      agent: 'chat',
      step: 'manual-compact-handoff',
      prompt: compacted.prompt,
      systemPrompt,
      model: useModel,
      workingDirectory: getWorkspaceRoot(),
      allowedTools: [],
      forceNewSession: true,
      appendSystemPrompt: false,
      mcpServers: enabledMcpServers,
      userId: user.id,
    }), () => engine.cancel());

    if (!result.success && !result.sessionId) {
      throw new Error(result.error || '上下文压缩失败');
    }

    return jsonOk({
      ok: true,
      sessionId: result.sessionId || null,
      previousSessionId: requestedRuntimeSessionId || null,
      method: compacted.method,
      summary: compacted.summary,
      engine: engineType,
      model: useModel,
    });
  } catch (error: any) {
    try { engineToCancel?.cancel(); } catch {}
    return jsonError(errorMessage(error) || '上下文压缩失败', 500);
  } finally {
    try { engineToCancel?.cancel(); } catch {}
  }
}
