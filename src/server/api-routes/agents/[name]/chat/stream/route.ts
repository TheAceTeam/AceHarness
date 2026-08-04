import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { EventEmitter } from 'events';
import { requireAuth } from '@/lib/auth/middleware';
import {
  buildAgentChatMemoryV2RecoverySource,
  finalizeAgentChatExecution,
  prepareAgentChat,
  type ExecuteAgentChatInput,
} from '@/lib/agent/chat-service';
import { extractStructuredResult } from '@/lib/ai/result-channel';
import {
  executeChatRuntimeWithContextRecovery,
  resolveRecoveredRuntimeSessionId,
} from '@/lib/chat/chat-engine-runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 1200;

const activeAgentStreams = new Map<string, {
  promise: Promise<any>;
  settled: boolean;
  frontendSessionId?: string | null;
  agentName?: string;
  diagnostics: {
    engineErrors: AgentEngineErrorPayload[];
  };
  cancel?: () => void;
}>();

const agentStreamEvents = new EventEmitter();
agentStreamEvents.setMaxListeners(200);

type StreamBody = {
  message?: string;
  mode?: 'standalone-chat' | 'workflow-chat';
  runtimeSessionId?: string | null;
  sessionId?: string | null;
  frontendSessionId?: string | null;
  workingDirectory?: string;
  workflowContext?: Record<string, any>;
  temporaryRoleConfig?: Record<string, any>;
  requestedMcpServers?: string[] | Record<string, boolean>;
  mcpServers?: string[] | Record<string, boolean>;
};

type AgentEngineErrorSource = 'api-provider' | 'aceharness-runtime' | 'unknown';

function classifyAgentEngineError(message: string): {
  source: AgentEngineErrorSource;
  sourceLabel: string;
} {
  const normalized = String(message || '').toLowerCase();
  if (/(insufficient_balance|insufficient balance|status(?:code)?\s*[=:]?\s*(?:401|402|403|408|409|429|5\d\d)|\b(?:401|402|403|408|409|429|5\d\d)\b|api provider|provider|upstream|rate limit|quota|billing|model.*capacity|capacity)/i.test(normalized)) {
    return { source: 'api-provider', sourceLabel: 'API 提供商响应' };
  }
  if (/(runtime session|aceharness|runtime turn|memory v2|context window|stream not found)/i.test(normalized)) {
    return { source: 'aceharness-runtime', sourceLabel: 'ACEHarness 运行时' };
  }
  return { source: 'unknown', sourceLabel: 'Agent 运行时事件' };
}

function buildAgentEngineErrorPayload(
  message: string,
  prepared: { engineType?: string; model?: string },
  options: { recoverable?: boolean } = {},
) {
  const classification = classifyAgentEngineError(message);
  return {
    message,
    source: classification.source,
    sourceLabel: classification.sourceLabel,
    stage: 'engine',
    engine: prepared.engineType || undefined,
    model: prepared.model || undefined,
    recoverable: options.recoverable || undefined,
  };
}

type AgentEngineErrorPayload = ReturnType<typeof buildAgentEngineErrorPayload>;

function agentStreamFailureResponse(input: {
  message: string;
  code: string;
  sourceLabel: string;
  retryable?: boolean;
}): Response {
  const encoder = new TextEncoder();
  const payload = {
    message: input.message,
    code: input.code,
    source: 'aceharness-stream',
    sourceLabel: input.sourceLabel,
    retryable: input.retryable ?? true,
  };
  return new Response(
    encoder.encode(`event: failed\ndata: ${JSON.stringify(payload)}\n\n`),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    },
  );
}

function hasAgoraResult(rawOutput: string, expectedType: 'speech' | 'summary' | 'vote'): boolean {
  return Boolean(extractStructuredResult<{ kind: 'agora_result'; payload: Record<string, any> }>(
    rawOutput,
    (value: any): value is { kind: 'agora_result'; payload: Record<string, any> } => Boolean(
      value
      && typeof value === 'object'
      && value.kind === 'agora_result'
      && value.payload
      && typeof value.payload === 'object'
      && value.payload.type === expectedType
      && typeof value.payload.content === 'string'
      && value.payload.content.trim()
    ),
  ));
}

function buildAgoraResultRetryPrompt(expectedType: 'speech' | 'summary' | 'vote'): string {
  const schema = expectedType === 'summary'
    ? '{"kind":"agora_result","payload":{"type":"summary","title":"本轮总结","content":"共识：...\\n分歧：...\\n风险：...\\n下一步：..."}}'
    : expectedType === 'vote'
      ? '{"kind":"agora_result","payload":{"type":"vote","content":"你的选择\\n理由：一句话","choice":"精确选项文本或弃权","reason":"一句简短理由"}}'
      : '{"kind":"agora_result","payload":{"type":"speech","content":"最终要发出的群聊内容","mentions":["被你@的人名，可为空数组"]}}';
  return [
    `你上一条回复不合规：缺少可解析的议场 <result> 结果块，或 payload.type 不是 "${expectedType}"。`,
    '不要重复过程说明，不要展示任何工具、规则、草稿或解释。',
    '现在仅基于同一回合补发一个合规的 `<result>JSON</result>`。',
    `唯一允许输出的格式是：<result>${schema}</result>`,
    '如果需要给人看的最终发言，只能放进 payload.content；输出 </result> 后不要再追加任何文字。',
  ].join('\n');
}

export async function POST(
  request: Request,
  { params }: { params: { name: string } | Promise<{ name: string }> }
) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const { name } = await params;
    const body = await readJsonBody<StreamBody>(request, {});
    const streamId = `agent-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const streamDiagnostics: { engineErrors: AgentEngineErrorPayload[] } = { engineErrors: [] };
    const frontendSessionId = typeof body?.frontendSessionId === 'string' && body.frontendSessionId.trim()
      ? body.frontendSessionId.trim()
      : (typeof body?.workflowContext?.frontendSessionId === 'string' && body.workflowContext.frontendSessionId.trim()
        ? body.workflowContext.frontendSessionId.trim()
        : null);
    const requestedRuntimeSessionId = typeof body?.runtimeSessionId === 'string' && body.runtimeSessionId.trim()
      ? body.runtimeSessionId.trim()
      // 旧字段别名，仅用于读取未迁移调用方的输入。
      : (typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null);
    const prepared = await prepareAgentChat({
      agentName: name,
      message: String(body?.message || ''),
      mode: body?.mode === 'workflow-chat' ? 'workflow-chat' : 'standalone-chat',
      sessionId: requestedRuntimeSessionId,
      frontendSessionId,
      workingDirectory: typeof body?.workingDirectory === 'string' ? body.workingDirectory : undefined,
      workflowContext: body?.workflowContext && typeof body.workflowContext === 'object'
        ? body.workflowContext as Record<string, any>
        : null,
      temporaryRoleConfig: body?.temporaryRoleConfig && typeof body.temporaryRoleConfig === 'object'
        ? body.temporaryRoleConfig as any
        : null,
      requestedMcpServers: body?.requestedMcpServers ?? body?.mcpServers,
      userContext: {
        id: user.id,
        username: user.username,
        personalDir: user.personalDir,
      },
    } satisfies ExecuteAgentChatInput);
    const onEngineStream = (evt: any) => {
      if (!evt) return;
      if (evt?.type === 'text' && evt.content) {
        agentStreamEvents.emit(streamId, { type: 'delta', content: evt.content });
      } else if (evt?.type === 'tool' && evt.tool) {
        agentStreamEvents.emit(streamId, { type: 'tool', tool: evt.tool });
      } else if (evt?.type === 'thought' && evt.content) {
        agentStreamEvents.emit(streamId, { type: 'thinking', content: evt.content });
      } else if (evt?.type === 'error' && evt.content) {
        const errorPayload = buildAgentEngineErrorPayload(String(evt.content), prepared);
        streamDiagnostics.engineErrors.push(errorPayload);
        agentStreamEvents.emit(streamId, { type: 'engine_error', ...errorPayload });
      }
    };

    prepared.engine.on('stream', onEngineStream);

    const execPromise = (async () => {
      if (!prepared.isTemporaryAgora) {
        return executeChatRuntimeWithContextRecovery(prepared.engine, {
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
          userId: prepared.userId,
        }, {
          buildCompactSource: () => buildAgentChatMemoryV2RecoverySource(prepared, prepared.prompt),
          onContextReset: () => {
            const errorPayload = buildAgentEngineErrorPayload(
              '上下文超限，已清空会话并自动接力继续。',
              prepared,
              { recoverable: true },
            );
            streamDiagnostics.engineErrors.push(errorPayload);
            agentStreamEvents.emit(streamId, { type: 'engine_error', ...errorPayload });
          },
        });
      }

      const expectedAgoraType = prepared.agoraExpectedResultType || 'speech';
      let latestSessionId = prepared.resumeSessionId || undefined;
      let lastResult: any = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const isRetry = attempt > 0;
        const result = await executeChatRuntimeWithContextRecovery(prepared.engine, {
          agent: prepared.roleConfig.name,
          step: isRetry ? `${prepared.mode}-agora-result-retry-${attempt}` : prepared.mode,
          prompt: isRetry ? buildAgoraResultRetryPrompt(expectedAgoraType) : prepared.prompt,
          systemPrompt: prepared.roleConfig.systemPrompt || `你是 ${prepared.roleConfig.name}。`,
          model: prepared.model,
          workingDirectory: prepared.workingDirectory,
          allowedTools: prepared.roleConfig.allowedTools,
          sessionId: latestSessionId,
          appendSystemPrompt: false,
          mcpServers: prepared.roleConfig.mcpServers,
          userId: prepared.userId,
        }, {
          buildCompactSource: () => buildAgentChatMemoryV2RecoverySource(prepared, prepared.prompt),
          onContextReset: () => {
            latestSessionId = undefined;
            const errorPayload = buildAgentEngineErrorPayload(
              '上下文超限，已清空会话并自动接力继续。',
              prepared,
              { recoverable: true },
            );
            streamDiagnostics.engineErrors.push(errorPayload);
            agentStreamEvents.emit(streamId, { type: 'engine_error', ...errorPayload });
          },
        });
        lastResult = result;
        latestSessionId = resolveRecoveredRuntimeSessionId(result, latestSessionId) || undefined;
        if (hasAgoraResult(result.output || '', expectedAgoraType)) return result;
      }
      return lastResult;
    })().then(async (result) => {
      const finalResult = await finalizeAgentChatExecution({
        prepared,
        userMessage: String(body?.message || ''),
        rawOutput: result.output || '',
        success: result.success,
        error: result.error || null,
        sessionId: resolveRecoveredRuntimeSessionId(result, prepared.resumeSessionId),
      });
      return {
        ...finalResult,
        runtimeSessionId: finalResult.sessionId || resolveRecoveredRuntimeSessionId(result, prepared.resumeSessionId),
      };
    }).finally(() => {
      prepared.engine.off('stream', onEngineStream);
      prepared.releaseMemoryV2();
    });

    const entry = {
      promise: execPromise,
      settled: false,
      frontendSessionId,
      agentName: name,
      diagnostics: streamDiagnostics,
      cancel: () => {
        prepared.engine.cancel();
        prepared.releaseMemoryV2();
      },
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

    return jsonOk({ streamId });
  } catch (error: any) {
    return jsonError(errorMessage(error) || 'Agent 流式对话启动失败', 500);
  }
}

export async function GET(request: Request) {
  const streamId = requestUrl(request).searchParams.get('id');
  if (!streamId) {
    return jsonError('Missing id', 400);
  }

  const entry = activeAgentStreams.get(streamId);
  if (!entry) {
    return agentStreamFailureResponse({
      message: `ACEHarness 找不到 Agent 流：${streamId}。服务端流状态已过期、进程已重启或当前请求落在了没有该流的服务实例。`,
      code: 'AGENT_STREAM_NOT_FOUND',
      sourceLabel: 'ACEHarness 流状态管理',
    });
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
        } else if (evt.type === 'tool' && evt.tool) {
          send('tool', { tool: evt.tool });
        } else if (evt.type === 'thinking') {
          send('thinking', { content: evt.content });
        } else if (evt.type === 'engine_error') {
          send('engine_error', {
            message: evt.message || evt.content || 'Agent 引擎返回错误',
            source: evt.source,
            sourceLabel: evt.sourceLabel,
            stage: evt.stage || 'engine',
            engine: evt.engine,
            model: evt.model,
            recoverable: Boolean(evt.recoverable),
          });
        }
      };

      agentStreamEvents.on(streamId, onAgentStream);
      send('connected', {
        streamId,
        source: 'aceharness-stream',
        sourceLabel: 'ACEHarness Agent SSE 接口',
        stage: 'connected',
      });
      for (const errorPayload of entry.diagnostics.engineErrors) {
        send('engine_error', { ...errorPayload, replayed: true });
      }

      entry.promise
        .then((result: any) => {
          if (result?.isError) {
            const message = String(result?.error || result?.output || 'Agent 执行失败');
            const classification = classifyAgentEngineError(message);
            send('done', {
              ...result,
              code: String(result?.code || 'AGENT_EXECUTION_FAILED'),
              source: classification.source,
              sourceLabel: classification.sourceLabel,
              stage: 'execution-finalize',
            });
            return;
          }
          send('done', result);
        })
        .catch((err: any) => {
          const message = String(err?.message || 'Agent 执行失败');
          const classification = classifyAgentEngineError(message);
          send('failed', {
            message,
            code: String(err?.code || 'AGENT_STREAM_FAILED'),
            source: classification.source,
            sourceLabel: classification.sourceLabel,
            stage: 'stream-finalize',
            streamId,
          });
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

export async function DELETE(request: Request) {
  const frontendSessionId = requestUrl(request).searchParams.get('frontendSessionId')?.trim();
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
    return jsonOk({ killed: true, count: killed });
  }

  const streamId = requestUrl(request).searchParams.get('id');
  if (!streamId) {
    return jsonError('Missing id', 400);
  }
  const entry = activeAgentStreams.get(streamId);
  if (entry?.cancel) {
    entry.cancel();
  }
  activeAgentStreams.delete(streamId);
  return jsonOk({ killed: true });
}
