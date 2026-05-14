import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/core/process-manager';
import { getOrCreateEngine, resolveRequestedEngineType } from '@/lib/engines/engine-factory';
import { isAceTimingDebug } from '@/lib/engines/acp-engine';
import type { Engine, EngineResultMetadata, EngineTokenUsage } from '@/lib/engines/engine-interface';
import {
  registerEngineStream,
  appendEngineStreamContent,
  setEngineStreamSessionId,
  setEngineStreamStatus,
  getEngineStream,
  getEngineStreamByFrontendSessionId,
  getBackendSessionIdByFrontendSessionId,
  removeEngineStream,
} from '@/lib/chat/stream-state';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { requireAuth } from '@/lib/auth/middleware';
import { EventEmitter } from 'events';
import { buildChatRequestContext, ensureEngineRuntimeSkillsAvailable, type RequestedSkillsInput } from '@/lib/chat/request-options';

export const dynamic = 'force-dynamic';

function numberOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeUsage(metadata?: EngineResultMetadata): Partial<EngineTokenUsage> | undefined {
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

function metadataNumber(metadata: EngineResultMetadata | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    const numeric = numberOrUndefined(value);
    if (numeric !== undefined) return numeric;
  }
  return undefined;
}

function resolveStreamRecoveryKey(frontendSessionId?: string, streamScope?: string): string | undefined {
  if (!frontendSessionId) return undefined;
  const normalizedScope = typeof streamScope === 'string' ? streamScope.trim().replace(/[^a-zA-Z0-9_-]/g, '-') : '';
  return normalizedScope ? `${frontendSessionId}:${normalizedScope}` : frontendSessionId;
}

// Track active chat streams
const activeChats = new Map<string, {
  promise: Promise<any>;
  settled: boolean;
  chatId: string;
  cancel?: () => void;
}>();
const engineStreamEvents = new EventEmitter();
engineStreamEvents.setMaxListeners(200);

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const {
      message,
      model,
      engine: perChatEngine,
      sessionId,
      frontendSessionId,
      streamScope,
      mode,
      workingDirectory,
      extraSystemPrompt,
      skills,
    } = await request.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const chatId = `chat-${Date.now()}`;
    const streamPrepT0 = Date.now();
    const useModel = model || '';

    const isResume = !!sessionId;
    const { systemPrompt } = await buildChatRequestContext({
      mode,
      sessionId,
      frontendSessionId,
      workingDirectory,
      extraSystemPrompt,
      requestedSkills: skills as RequestedSkillsInput,
      personalDir: auth.personalDir,
    });

    // If resuming, trust the session ID directly — don't waste 10s on a probe.
    // If the session is actually expired, Claude CLI will fail fast and we retry
    // as a new session with history injection.
    let validResumeSid: string | undefined = undefined;
    if (isResume) {
      validResumeSid = sessionId;
    }
    const engineRuntimeDirectory = getWorkspaceRoot();
    const configuredEngine = await resolveRequestedEngineType(perChatEngine);
    const streamRecoveryKey = resolveStreamRecoveryKey(frontendSessionId, streamScope);
    if (!validResumeSid && streamRecoveryKey) {
      validResumeSid = getBackendSessionIdByFrontendSessionId(streamRecoveryKey);
    }
    const engine = await getOrCreateEngine(configuredEngine, streamRecoveryKey || frontendSessionId);

    if (isAceTimingDebug()) {
      console.log(
        `[ACE_TIMING][chat/stream][${chatId}] S0_auth_prompts_pool: ${Date.now() - streamPrepT0}ms (engine=${configuredEngine})`
      );
    }

    // Ensure engine config dir + skills symlink exists in working directory
    if (engine) {
      await ensureEngineRuntimeSkillsAvailable(configuredEngine, engineRuntimeDirectory);
    }

    if (engine && isAceTimingDebug()) {
      console.log(
        `[ACE_TIMING][chat/stream][${chatId}] S1_ready_before_execute: ${Date.now() - streamPrepT0}ms (symlink+pool)`
      );
    }

    // Non-Claude engines: stream through Engine wrapper events
    if (engine) {
      registerEngineStream(chatId, streamRecoveryKey, configuredEngine, useModel);

      // Register in processManager so recovery endpoint can find it
      const proc = processManager.registerExternalProcess(chatId, 'chat', 'chat');
      if (streamRecoveryKey) {
        proc.frontendSessionId = streamRecoveryKey;
        processManager.registerActiveStream(streamRecoveryKey, chatId);
      }

      const onEngineStream = (evt: any) => {
        if ((evt?.type === 'text' || evt?.type === 'tool') && evt.content) {
          appendEngineStreamContent(chatId, evt.content);
          processManager.appendStreamContent(chatId, evt.content);
          engineStreamEvents.emit(chatId, { type: 'delta', content: evt.content });
        } else if (evt?.type === 'session' && evt.content) {
          setEngineStreamSessionId(chatId, evt.content);
          if (proc) proc.sessionId = evt.content;
          engineStreamEvents.emit(chatId, { type: 'session', sessionId: evt.content });
        } else if (evt?.type === 'thought' && evt.content) {
          engineStreamEvents.emit(chatId, { type: 'thinking', content: evt.content });
        } else if (evt?.type === 'error' && evt.content) {
          engineStreamEvents.emit(chatId, { type: 'engine_error', content: evt.content });
        }
      };

      engine.on('stream', onEngineStream);

      const startedAt = Date.now();
      const execPromise = engine.execute({
        agent: 'chat',
        step: 'chat',
        prompt: message,
        systemPrompt,
        model: useModel,
        workingDirectory: engineRuntimeDirectory,
        sessionId: validResumeSid,
        appendSystemPrompt: !!validResumeSid && !!systemPrompt,
      }).then((result) => {
        if (isAceTimingDebug()) {
          console.log(
            `[ACE_TIMING][chat/stream][${chatId}] S2_engine_execute_wall: ${Date.now() - startedAt}ms (platform overhead ≈ S1; agent+ACP ≈ wrap.W4 / acp.6)`
          );
        }
        if (result.sessionId) {
          setEngineStreamSessionId(chatId, result.sessionId);
          if (proc) proc.sessionId = result.sessionId;
        }
        const state = getEngineStream(chatId);
        const output = result.output || state?.streamContent || '';

        // Update processManager state
        if (proc) {
          proc.status = result.success ? 'completed' : 'failed';
          proc.endTime = new Date();
          processManager.setProcessOutput(chatId, output);
        }

        if (!result.success && !output && result.error) {
          throw new Error(result.error);
        }

        const metadata = result.metadata;
        return {
          result: output,
          session_id: result.sessionId,
          cost_usd: metadataNumber(metadata, 'cost_usd', 'costUsd') ?? 0,
          duration_ms: metadataNumber(metadata, 'duration_ms', 'durationMs') ?? (Date.now() - startedAt),
          usage: normalizeUsage(metadata),
          is_error: !result.success,
          error: result.error || undefined,
        };
      }).finally(() => {
        engine.off('stream', onEngineStream);
      });

      const entry = {
        promise: execPromise,
        settled: false,
        chatId,
        cancel: () => {
          setEngineStreamStatus(chatId, 'killed');
          engine.cancel();
        },
      };
      activeChats.set(chatId, entry);
      void execPromise.catch((err) => {
        console.error(`[chat/stream] engine execute failed chatId=${chatId}`, err);
      });
      execPromise
        .then(() => { entry.settled = true; setEngineStreamStatus(chatId, 'completed'); })
        .catch(() => { entry.settled = true; setEngineStreamStatus(chatId, 'failed'); })
        .finally(() => {
          setTimeout(() => {
            activeChats.delete(chatId);
            removeEngineStream(chatId);
            if (streamRecoveryKey) processManager.removeActiveStream(streamRecoveryKey);
          }, 30000);
        });

      return NextResponse.json({ chatId });
    }

    // All engines (including claude-code) should be handled above via getOrCreateEngine.
    // If engine is null, it means the engine is not available.
    return NextResponse.json({ error: '引擎不可用，请检查配置' }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '启动失败' }, { status: 500 });
  }
}
export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('id');
  const checkSession = request.nextUrl.searchParams.get('checkActive');
  const streamScope = request.nextUrl.searchParams.get('streamScope') || undefined;

  // Check if a frontend session has an active stream
  if (checkSession) {
    const recoveryKey = resolveStreamRecoveryKey(checkSession, streamScope);
    const engineState = recoveryKey ? getEngineStreamByFrontendSessionId(recoveryKey) : undefined;
    if (engineState) {
      return NextResponse.json({
        active: engineState.status === 'running',
        found: true,
        chatId: engineState.chatId,
        streamContent: engineState.streamContent || '',
        status: engineState.status,
        engine: engineState.engine || '',
        model: engineState.model || '',
        backendSessionId: engineState.backendSessionId || '',
      });
    }

    const activeChatId = recoveryKey ? processManager.getActiveStreamChatId(recoveryKey) : undefined;
    if (activeChatId && activeChats.has(activeChatId)) {
      const proc = processManager.getProcess(activeChatId);
      return NextResponse.json({
        active: true,
        found: true,
        chatId: activeChatId,
        streamContent: proc?.streamContent || '',
        status: proc?.status || 'running',
        engine: '',
        model: '',
      });
    }
    return NextResponse.json({ active: false });
  }

  if (!chatId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const entry = activeChats.get(chatId);
  if (!entry) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
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
        engineStreamEvents.off(chatId, onEngineStream);
        try { controller.close(); } catch {}
      };

      const onEngineStream = (evt: any) => {
        if (!evt) return;
        if (evt.type === 'delta') {
          send('delta', { content: evt.content });
        } else if (evt.type === 'session') {
          send('session', { sessionId: evt.sessionId });
        } else if (evt.type === 'thinking') {
          send('thinking', { content: evt.content });
        } else if (evt.type === 'engine_error') {
          send('engine_error', { message: evt.content || '执行失败' });
        }
      };

      const state = getEngineStream(chatId);
      if (state?.backendSessionId) {
        send('session', { sessionId: state.backendSessionId });
      }
      if (state?.streamContent) {
        send('delta', { content: state.streamContent });
      }
      engineStreamEvents.on(chatId, onEngineStream);

      send('connected', { chatId });

      // Wait for completion
      entry.promise
        .then((result: any) => {
          send('done', {
            result: result.result,
            sessionId: result.session_id,
            costUsd: result.cost_usd,
            durationMs: result.duration_ms,
            usage: result.usage,
            isError: result.is_error,
          });
        })
        .catch((err: any) => {
          send('failed', { message: err.message || '执行失败' });
        })
        .finally(() => {
          cleanup();
        });

      // Cleanup on client disconnect (but don't kill the process — let it finish)
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
  const frontendSessionId = request.nextUrl.searchParams.get('frontendSessionId');
  const streamScope = request.nextUrl.searchParams.get('streamScope') || undefined;
  const preserveSession = request.nextUrl.searchParams.get('preserveSession') === '1';
  if (frontendSessionId) {
    const recoveryKey = resolveStreamRecoveryKey(frontendSessionId, streamScope);
    const engineState = recoveryKey ? getEngineStreamByFrontendSessionId(recoveryKey) : undefined;
    const activeChatId = engineState?.chatId || (recoveryKey ? processManager.getActiveStreamChatId(recoveryKey) : undefined);
    if (!activeChatId) {
      return NextResponse.json({ killed: true, count: 0 });
    }
    const entry = activeChats.get(activeChatId);
    if (entry?.cancel) {
      entry.cancel();
    }
    activeChats.delete(activeChatId);
    if (recoveryKey) {
      processManager.removeActiveStream(recoveryKey);
    }
    if (!preserveSession) {
      removeEngineStream(activeChatId);
    } else if (engineState) {
      setEngineStreamStatus(activeChatId, 'killed');
    }
    processManager.killProcess(activeChatId);
    return NextResponse.json({ killed: true, count: 1, chatId: activeChatId, preserved: preserveSession });
  }

  const chatId = request.nextUrl.searchParams.get('id');
  if (!chatId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const entry = activeChats.get(chatId);
  if (entry?.cancel) {
    entry.cancel();
  }
  activeChats.delete(chatId);
  const state = getEngineStream(chatId);
  if (state?.frontendSessionId) {
    processManager.removeActiveStream(state.frontendSessionId);
  }
  if (!preserveSession) {
    removeEngineStream(chatId);
  } else if (state) {
    setEngineStreamStatus(chatId, 'killed');
  }
  processManager.killProcess(chatId);
  return NextResponse.json({ killed: true, preserved: preserveSession });
}
