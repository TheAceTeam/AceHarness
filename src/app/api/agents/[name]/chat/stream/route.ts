import { EventEmitter } from 'events';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import {
  finalizeAgentChatExecution,
  prepareAgentChat,
  type ExecuteAgentChatInput,
} from '@/lib/agent/chat-service';
import { extractStructuredResult } from '@/lib/ai/result-channel';
import { executeEngineWithContextRecovery, resolveRecoveredSessionId } from '@/lib/engines/context-recovery';

export const dynamic = 'force-dynamic';

const activeAgentStreams = new Map<string, {
  promise: Promise<any>;
  settled: boolean;
  frontendSessionId?: string | null;
  agentName?: string;
  cancel?: () => void;
}>();

const agentStreamEvents = new EventEmitter();
agentStreamEvents.setMaxListeners(200);

type StreamBody = {
  message?: string;
  mode?: 'standalone-chat' | 'workflow-chat';
  sessionId?: string | null;
  frontendSessionId?: string | null;
  workingDirectory?: string;
  workflowContext?: Record<string, any>;
  temporaryRoleConfig?: Record<string, any>;
};

function hasWerewolfResult(rawOutput: string): boolean {
  return Boolean(extractStructuredResult<Record<string, any>>(
    rawOutput,
    (value: any): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  ));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const { name } = await params;
    const body = await request.json() as StreamBody;
    const streamId = `agent-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const frontendSessionId = typeof body?.frontendSessionId === 'string' && body.frontendSessionId.trim()
      ? body.frontendSessionId.trim()
      : (typeof body?.workflowContext?.frontendSessionId === 'string' && body.workflowContext.frontendSessionId.trim()
        ? body.workflowContext.frontendSessionId.trim()
        : null);
    const prepared = await prepareAgentChat({
      agentName: name,
      message: String(body?.message || ''),
      mode: body?.mode === 'workflow-chat' ? 'workflow-chat' : 'standalone-chat',
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : null,
      workingDirectory: typeof body?.workingDirectory === 'string' ? body.workingDirectory : undefined,
      workflowContext: body?.workflowContext && typeof body.workflowContext === 'object'
        ? body.workflowContext as Record<string, any>
        : null,
      temporaryRoleConfig: body?.temporaryRoleConfig && typeof body.temporaryRoleConfig === 'object'
        ? body.temporaryRoleConfig as any
        : null,
      userContext: {
        id: user.id,
        username: user.username,
        personalDir: user.personalDir,
      },
    } satisfies ExecuteAgentChatInput);
    const suppressIntermediateStream = prepared.isTemporaryWerewolf;

    const onEngineStream = (evt: any) => {
      if (!evt) return;
      if (suppressIntermediateStream) return;
      if ((evt?.type === 'text' || evt?.type === 'tool') && evt.content) {
        agentStreamEvents.emit(streamId, { type: 'delta', content: evt.content });
      } else if (evt?.type === 'thought' && evt.content) {
        agentStreamEvents.emit(streamId, { type: 'thinking', content: evt.content });
      } else if (evt?.type === 'error' && evt.content) {
        agentStreamEvents.emit(streamId, { type: 'engine_error', content: evt.content });
      }
    };

    prepared.engine.on('stream', onEngineStream);

    const execPromise = (async () => {
      if (!prepared.isTemporaryWerewolf) {
        return executeEngineWithContextRecovery(prepared.engine, {
          agent: prepared.roleConfig.name,
          step: prepared.mode,
          prompt: prepared.prompt,
          systemPrompt: prepared.roleConfig.systemPrompt || `你是 ${prepared.roleConfig.name}。`,
          model: prepared.model,
          workingDirectory: prepared.workingDirectory,
          allowedTools: prepared.roleConfig.allowedTools,
          sessionId: prepared.resumeSessionId || undefined,
          appendSystemPrompt: Boolean(prepared.resumeSessionId),
          mcpServers: prepared.roleConfig.mcpServers,
        }, {
          onContextReset: () => {
            agentStreamEvents.emit(streamId, { type: 'engine_error', content: '上下文超限，已清空会话并自动接力继续。' });
          },
        });
      }

      const maxAttempts = 3;
      let latestSessionId = prepared.resumeSessionId || undefined;
      let lastResult: any = null;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const isRetry = attempt > 0;
        const result = await executeEngineWithContextRecovery(prepared.engine, {
          agent: prepared.roleConfig.name,
          step: isRetry ? `${prepared.mode}-result-retry-${attempt}` : prepared.mode,
          prompt: isRetry
            ? [
                '你上一条回复不合规：缺少 `<result>JSON</result>` 结果块。',
                '不要重复过程说明，不要展示任何工具、规则、草稿或解释。',
                '现在仅基于同一回合补发一个合规的 `<result>JSON</result>`。',
                '如果需要给人看的内容，把它放进 `display` 字段；如果这是机器决策回合，也把 action / target / save / poisonTarget / reason 等字段一起放进同一个 JSON。',
              ].join('\n')
            : prepared.prompt,
          systemPrompt: prepared.roleConfig.systemPrompt || `你是 ${prepared.roleConfig.name}。`,
          model: prepared.model,
          workingDirectory: prepared.workingDirectory,
          allowedTools: prepared.roleConfig.allowedTools,
          sessionId: latestSessionId,
          appendSystemPrompt: false,
          mcpServers: prepared.roleConfig.mcpServers,
        }, {
          onContextReset: () => {
            latestSessionId = undefined;
            agentStreamEvents.emit(streamId, { type: 'engine_error', content: '上下文超限，已清空会话并自动接力继续。' });
          },
        });
        lastResult = result;
        latestSessionId = resolveRecoveredSessionId(result, latestSessionId) || undefined;
        if (hasWerewolfResult(result.output || '')) return result;
      }
      return lastResult;
    })().then(async (result) => {
      const finalResult = await finalizeAgentChatExecution({
        prepared,
        userMessage: String(body?.message || ''),
        rawOutput: result.output || '',
        success: result.success,
        error: result.error || null,
        sessionId: resolveRecoveredSessionId(result, prepared.resumeSessionId),
      });
      return finalResult;
    }).finally(() => {
      prepared.engine.off('stream', onEngineStream);
    });

    const entry = {
      promise: execPromise,
      settled: false,
      frontendSessionId,
      agentName: name,
      cancel: () => prepared.engine.cancel(),
    };
    activeAgentStreams.set(streamId, entry);
    execPromise
      .then(() => { entry.settled = true; })
      .catch(() => { entry.settled = true; })
      .finally(() => {
        setTimeout(() => {
          activeAgentStreams.delete(streamId);
        }, 30000);
      });

    return NextResponse.json({ streamId });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Agent 流式对话启动失败' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const streamId = request.nextUrl.searchParams.get('id');
  if (!streamId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const entry = activeAgentStreams.get(streamId);
  if (!entry) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        closed = true;
        agentStreamEvents.off(streamId, onAgentStream);
        try { controller.close(); } catch {}
      };

      const onAgentStream = (evt: any) => {
        if (!evt) return;
        if (evt.type === 'delta') {
          send('delta', { content: evt.content });
        } else if (evt.type === 'thinking') {
          send('thinking', { content: evt.content });
        } else if (evt.type === 'engine_error') {
          send('engine_error', { message: evt.content || '执行失败' });
        }
      };

      agentStreamEvents.on(streamId, onAgentStream);
      send('connected', { streamId });

      entry.promise
        .then((result: any) => {
          send('done', result);
        })
        .catch((err: any) => {
          send('failed', { message: err?.message || '执行失败' });
        })
        .finally(() => {
          cleanup();
        });

      request.signal.addEventListener('abort', () => {
        cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function DELETE(request: NextRequest) {
  const frontendSessionId = request.nextUrl.searchParams.get('frontendSessionId')?.trim();
  if (frontendSessionId) {
    let killed = 0;
    for (const [streamId, entry] of activeAgentStreams.entries()) {
      if (entry.frontendSessionId !== frontendSessionId) continue;
      if (entry.cancel) {
        entry.cancel();
      }
      activeAgentStreams.delete(streamId);
      killed += 1;
    }
    return NextResponse.json({ killed: true, count: killed });
  }

  const streamId = request.nextUrl.searchParams.get('id');
  if (!streamId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }
  const entry = activeAgentStreams.get(streamId);
  if (entry?.cancel) {
    entry.cancel();
  }
  activeAgentStreams.delete(streamId);
  return NextResponse.json({ killed: true });
}
