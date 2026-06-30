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
  setEngineStreamLiveSession,
  updateEngineStreamLiveSession,
  getEngineStream,
  getEngineStreamByFrontendSessionId,
  getBackendSessionIdByFrontendSessionId,
  removeEngineStream,
} from '@/lib/chat/stream-state';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { requireAuth } from '@/lib/auth/middleware';
import { EventEmitter } from 'events';
import {
  buildChatRequestContext,
  ensureEngineRuntimeSkillsAvailable,
  type RequestedMcpServersInput,
  type RequestedSkillsInput,
} from '@/lib/chat/request-options';
import { executeEngineWithContextRecovery, resolveRecoveredSessionId } from '@/lib/engines/context-recovery';
import { buildFinalRawContent, appendStreamChunk } from '@/lib/chat/stream-assembly';
import { isSafeAction, normalizeAssistantDisplay, parseActions } from '@/lib/chat/actions';
import { loadChatSession, saveChatSession, type PersistedChatSession, type PersistedMessage } from '@/lib/chat/persistence';
import { normalizeEngineNamespacedSlashCommand } from '@/lib/chat/engine-slash-command';

export const dynamic = 'force-dynamic';
export const maxDuration = 1200;
const COMPLETED_STREAM_RETENTION_MS = 2 * 60 * 1000;
const LIVE_SESSION_SAVE_INTERVAL_MS = 5000;

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

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function canUsePersistedSession(session: PersistedChatSession | null, userId: string): session is PersistedChatSession {
  if (!session) return false;
  return !session.createdBy || session.createdBy === userId;
}

function updateMessageById(
  messages: PersistedMessage[],
  messageId: string,
  updater: (message: PersistedMessage) => PersistedMessage,
): PersistedMessage[] {
  return messages.map((message) => (message.id === messageId ? updater(message) : message));
}

function getMessageById(messages: PersistedMessage[], messageId: string): PersistedMessage | undefined {
  return messages.find((message) => message.id === messageId);
}

function buildInitialLiveSessionSnapshot(input: {
  frontendSessionId: string;
  message: string;
  displayMessage?: string;
  engine?: string;
  model: string;
  backendSessionId?: string;
  existingSession?: PersistedChatSession | null;
  userId: string;
  userMessageId?: string;
  assistantMessageId?: string;
  skipUserMessage?: boolean;
}): PersistedChatSession {
  const now = Date.now();
  const visibleUserMessage = String(input.displayMessage || input.message || '').trim();
  const existing = input.existingSession;
  const userMessage: PersistedMessage = {
    id: input.userMessageId || genId(),
    role: 'user',
    content: visibleUserMessage,
    timestamp: now,
  };
  const assistantMessage: PersistedMessage = {
    id: input.assistantMessageId || genId(),
    role: 'assistant',
    content: '',
    rawContent: '',
    engine: input.engine || existing?.engine,
    model: input.model || existing?.model,
    timestamp: now + 1,
  };
  const nextMessages = [...(existing?.messages || [])];
  if (!input.skipUserMessage && !nextMessages.some((message) => message.id === userMessage.id)) {
    nextMessages.push(userMessage);
  }
  if (!nextMessages.some((message) => message.id === assistantMessage.id)) {
    nextMessages.push(assistantMessage);
  }

  return {
    id: input.frontendSessionId,
    title: existing?.messages?.length ? existing.title : (visibleUserMessage.slice(0, 30) || existing?.title || '新对话'),
    model: input.model || existing?.model || '',
    engine: input.engine || existing?.engine,
    backendSessionId: input.backendSessionId || existing?.backendSessionId,
    workflowBinding: existing?.workflowBinding,
    creationSession: existing?.creationSession,
    agentBinding: existing?.agentBinding,
    sessionWorkbenchState: existing?.sessionWorkbenchState,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: nextMessages,
    createdBy: existing?.createdBy || input.userId,
    visibility: existing?.visibility || 'public',
  };
}

function createLiveSessionSaver() {
  let lastSavedAt = 0;
  let pending = false;

  return (session: PersistedChatSession | undefined, options: { force?: boolean } = {}) => {
    if (!session) return;
    const now = Date.now();
    if (!options.force && (pending || now - lastSavedAt < LIVE_SESSION_SAVE_INTERVAL_MS)) return;
    pending = true;
    lastSavedAt = now;
    void saveChatSession(session)
      .catch(() => {})
      .finally(() => {
        pending = false;
      });
  };
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
      displayMessage,
      model,
      engine: perChatEngine,
      sessionId,
      frontendSessionId,
      skipUserMessage,
      userMessageId,
      assistantMessageId,
      streamScope,
      mode,
      workingDirectory,
      extraSystemPrompt,
      skills,
      mcpServers,
    } = await request.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const chatId = `chat-${Date.now()}`;
    const streamPrepT0 = Date.now();
    const useModel = model || '';

    const isResume = !!sessionId;
    const { systemPrompt, runtimeSkillNames, enabledMcpServers, runtimeDatabaseEnv } = await buildChatRequestContext({
      mode,
      sessionId,
      frontendSessionId,
      workingDirectory,
      extraSystemPrompt,
      requestedSkills: skills as RequestedSkillsInput,
      requestedMcpServers: mcpServers as RequestedMcpServersInput,
      personalDir: auth.personalDir,
    });

    // If resuming, trust the session ID directly — don't waste 10s on a probe.
    // If the session is actually expired, Claude CLI will fail fast and we retry
    // as a new session with history injection.
    let validResumeSid: string | undefined = undefined;
    if (isResume) {
      validResumeSid = sessionId;
    }
    const engineRuntimeDirectory = typeof workingDirectory === 'string' && workingDirectory.trim()
      ? workingDirectory.trim()
      : getWorkspaceRoot();
    const configuredEngine = await resolveRequestedEngineType(perChatEngine);
    const engineCommand = normalizeEngineNamespacedSlashCommand(message, configuredEngine);
    const streamRecoveryKey = resolveStreamRecoveryKey(frontendSessionId, streamScope);
    if (!validResumeSid && streamRecoveryKey) {
      validResumeSid = getBackendSessionIdByFrontendSessionId(streamRecoveryKey);
    }
    const engine = await getOrCreateEngine(configuredEngine, streamRecoveryKey || frontendSessionId, auth.id);
    const shouldTrackLiveSession = Boolean(frontendSessionId && !streamScope);
    const existingSession = shouldTrackLiveSession
      ? await loadChatSession(frontendSessionId).catch(() => null)
      : null;
    const baseLiveSession = shouldTrackLiveSession
      ? buildInitialLiveSessionSnapshot({
          frontendSessionId,
          message,
          displayMessage: typeof displayMessage === 'string' ? displayMessage : undefined,
          engine: configuredEngine,
          model: useModel,
          backendSessionId: validResumeSid,
          existingSession: canUsePersistedSession(existingSession, auth.id) ? existingSession : null,
          userId: auth.id,
          userMessageId: typeof userMessageId === 'string' ? userMessageId : undefined,
          assistantMessageId: typeof assistantMessageId === 'string' ? assistantMessageId : undefined,
          skipUserMessage: Boolean(skipUserMessage),
        })
      : null;
    const liveAssistantMessageId = typeof assistantMessageId === 'string' && assistantMessageId.trim()
      ? assistantMessageId.trim()
      : baseLiveSession?.messages.at(-1)?.id;

    if (isAceTimingDebug()) {
      console.log(
        `[ACE_TIMING][chat/stream][${chatId}] S0_auth_prompts_pool: ${Date.now() - streamPrepT0}ms (engine=${configuredEngine})`
      );
    }

    // Ensure engine config dir + skills symlink exists in working directory
    if (engine) {
      await ensureEngineRuntimeSkillsAvailable(configuredEngine, engineRuntimeDirectory, runtimeSkillNames);
    }

    if (engine && isAceTimingDebug()) {
      console.log(
        `[ACE_TIMING][chat/stream][${chatId}] S1_ready_before_execute: ${Date.now() - streamPrepT0}ms (symlink+pool)`
      );
    }

    // Non-Claude engines: stream through Engine wrapper events
    if (engine) {
      registerEngineStream(chatId, streamRecoveryKey, configuredEngine, useModel);
      const saveLiveSessionSnapshot = createLiveSessionSaver();
      if (baseLiveSession) {
        setEngineStreamLiveSession(chatId, baseLiveSession);
        saveLiveSessionSnapshot(baseLiveSession, { force: true });
      }

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
          if (baseLiveSession && liveAssistantMessageId) {
            const nextLiveSession = updateEngineStreamLiveSession(chatId, (session) => {
              if (!session) return session;
              const currentAssistant = getMessageById(session.messages, liveAssistantMessageId);
              if (!currentAssistant) return session;
              const nextRawContent = appendStreamChunk(String(currentAssistant.rawContent || ''), String(evt.content || ''));
              const visibleText = normalizeAssistantDisplay(nextRawContent, true).visibleText || parseActions(nextRawContent).text;
              return {
                ...session,
                backendSessionId: getEngineStream(chatId)?.backendSessionId || session.backendSessionId,
                updatedAt: Date.now(),
                engine: configuredEngine || session.engine,
                model: useModel || session.model,
                messages: updateMessageById(session.messages, liveAssistantMessageId, (message) => ({
                  ...message,
                  content: visibleText,
                  rawContent: nextRawContent,
                  engine: configuredEngine || message.engine,
                  model: useModel || message.model,
                })),
              };
            });
            saveLiveSessionSnapshot(nextLiveSession);
          }
          engineStreamEvents.emit(chatId, { type: 'delta', content: evt.content });
        } else if (evt?.type === 'session' && evt.content) {
          setEngineStreamSessionId(chatId, evt.content);
          if (proc) proc.sessionId = evt.content;
          if (baseLiveSession) {
            const nextLiveSession = updateEngineStreamLiveSession(chatId, (session) => {
              if (!session) return session;
              return {
                ...session,
                backendSessionId: String(evt.content),
                updatedAt: Date.now(),
              };
            });
            saveLiveSessionSnapshot(nextLiveSession, { force: true });
          }
          engineStreamEvents.emit(chatId, { type: 'session', sessionId: evt.content });
        } else if (evt?.type === 'thought' && evt.content) {
          if (baseLiveSession && liveAssistantMessageId) {
            const nextLiveSession = updateEngineStreamLiveSession(chatId, (session) => {
              if (!session) return session;
              const currentAssistant = getMessageById(session.messages, liveAssistantMessageId);
              if (!currentAssistant) return session;
              const nextRawContent = appendStreamChunk(String(currentAssistant.rawContent || ''), String(evt.content || ''));
              return {
                ...session,
                updatedAt: Date.now(),
                messages: updateMessageById(session.messages, liveAssistantMessageId, (message) => ({
                  ...message,
                  rawContent: nextRawContent,
                  engine: configuredEngine || message.engine,
                  model: useModel || message.model,
                })),
              };
            });
            saveLiveSessionSnapshot(nextLiveSession);
          }
          engineStreamEvents.emit(chatId, { type: 'thinking', content: evt.content });
        } else if (evt?.type === 'error' && evt.content) {
          engineStreamEvents.emit(chatId, { type: 'engine_error', content: evt.content });
        }
      };

      engine.on('stream', onEngineStream);

      const startedAt = Date.now();
      const execPromise = executeEngineWithContextRecovery(engine, {
        agent: 'chat',
        step: 'chat',
        prompt: engineCommand.prompt,
        systemPrompt,
        model: useModel,
        workingDirectory: engineRuntimeDirectory,
        sessionId: validResumeSid,
        appendSystemPrompt: !!validResumeSid && !!systemPrompt,
        mcpServers: enabledMcpServers,
        userId: auth.id,
        rawPrompt: engineCommand.rawPrompt,
        env: runtimeDatabaseEnv,
      }, {
        onContextReset: () => {
          engineStreamEvents.emit(chatId, { type: 'engine_error', content: '上下文超限，已清空会话并自动接力继续。' });
        },
      }).then((result) => {
        if (isAceTimingDebug()) {
          console.log(
            `[ACE_TIMING][chat/stream][${chatId}] S2_engine_execute_wall: ${Date.now() - startedAt}ms (platform overhead ≈ S1; agent+ACP ≈ wrap.W4 / acp.6)`
          );
        }
        const resolvedSessionId = resolveRecoveredSessionId(result, validResumeSid);
        setEngineStreamSessionId(chatId, resolvedSessionId || undefined);
        if (proc) proc.sessionId = resolvedSessionId || undefined;
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
        const responsePayload = {
          result: output,
          session_id: resolvedSessionId ?? null,
          cost_usd: metadataNumber(metadata, 'cost_usd', 'costUsd') ?? 0,
          duration_ms: metadataNumber(metadata, 'duration_ms', 'durationMs') ?? (Date.now() - startedAt),
          usage: normalizeUsage(metadata),
          is_error: !result.success,
          error: result.error || undefined,
        };
        if (baseLiveSession && liveAssistantMessageId) {
          const finalSession = updateEngineStreamLiveSession(chatId, (session) => {
            if (!session) return session;
            const currentAssistant = getMessageById(session.messages, liveAssistantMessageId);
            if (!currentAssistant) return session;
            const currentRawContent = String(currentAssistant.rawContent || '');
            const currentVisibleContent = String(currentAssistant.content || '');
            const fullRawContent = buildFinalRawContent(currentRawContent, currentVisibleContent, output);
            const now = Date.now();
            if (!result.success) {
              const partial = String(output || currentVisibleContent || '').trim();
              const failureMessage = String(result.error || '请求失败，请稍后重试');
              const errorContent = partial
                ? `请求失败：${failureMessage}\n\n已返回部分内容：\n${partial}`
                : `请求失败：${failureMessage}`;
              return {
                ...session,
                backendSessionId: resolvedSessionId || session.backendSessionId,
                updatedAt: now,
                engine: configuredEngine || session.engine,
                model: useModel || session.model,
                messages: updateMessageById(session.messages, liveAssistantMessageId, (message) => ({
                  ...message,
                  role: 'error',
                  content: errorContent,
                  rawContent: fullRawContent || message.rawContent,
                  engine: configuredEngine || message.engine,
                  model: useModel || message.model,
                  costUsd: responsePayload.cost_usd,
                  durationMs: responsePayload.duration_ms,
                  usage: responsePayload.usage,
                })),
              };
            }

            const parsed = parseActions(fullRawContent);
            const latestSidebarHint = parsed.sidebarHints[parsed.sidebarHints.length - 1];
            const actionStates = parsed.actions.map((action) => ({
              id: genId(),
              action,
              status: isSafeAction(action) ? 'auto_executing' : 'pending',
              timestamp: now,
            }));
            return {
              ...session,
              backendSessionId: resolvedSessionId || session.backendSessionId,
              updatedAt: now,
              engine: configuredEngine || session.engine,
              model: useModel || session.model,
              sessionWorkbenchState: latestSidebarHint ? {
                ...(session.sessionWorkbenchState || {}),
                homeSidebar: latestSidebarHint,
              } : session.sessionWorkbenchState,
              messages: updateMessageById(session.messages, liveAssistantMessageId, (message) => ({
                ...message,
                role: 'assistant',
                content: parsed.text,
                rawContent: fullRawContent !== parsed.text ? fullRawContent : undefined,
                actions: actionStates.length > 0 ? actionStates : undefined,
                cards: parsed.cards.length > 0 ? parsed.cards : undefined,
                engine: configuredEngine || message.engine,
                model: useModel || message.model,
                costUsd: responsePayload.cost_usd,
                durationMs: responsePayload.duration_ms,
                usage: responsePayload.usage,
              })),
            };
          });
          if (finalSession) {
            saveLiveSessionSnapshot(finalSession, { force: true });
          }
        }
        return responsePayload;
      }).catch((error: any) => {
        if (baseLiveSession && liveAssistantMessageId) {
          const failedSession = updateEngineStreamLiveSession(chatId, (session) => {
            if (!session) return session;
            const currentAssistant = getMessageById(session.messages, liveAssistantMessageId);
            if (!currentAssistant) return session;
            const message = String(error?.message || '请求失败');
            const partial = String(currentAssistant.content || '').trim();
            const failedBackendSessionId = getEngineStream(chatId)?.backendSessionId || proc?.sessionId || validResumeSid || session.backendSessionId;
            const errorContent = partial
              ? `请求失败：${message}\n\n已返回部分内容：\n${partial}`
              : `请求失败：${message}`;
            return {
              ...session,
              backendSessionId: failedBackendSessionId,
              updatedAt: Date.now(),
              messages: updateMessageById(session.messages, liveAssistantMessageId, (item) => ({
                ...item,
                role: 'error',
                content: errorContent,
                engine: configuredEngine || item.engine,
                model: useModel || item.model,
              })),
            };
          });
          if (failedSession) {
            saveLiveSessionSnapshot(failedSession, { force: true });
          }
        }
        throw error;
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
          }, COMPLETED_STREAM_RETENTION_MS);
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
        liveSession: engineState.liveSession || null,
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
          const state = getEngineStream(chatId);
          send('engine_error', { message: evt.content || '执行失败', sessionId: state?.backendSessionId || null });
        }
      };

      send('connected', { chatId });
      const state = getEngineStream(chatId);
      if (state?.backendSessionId) {
        send('session', { sessionId: state.backendSessionId });
      }
      engineStreamEvents.on(chatId, onEngineStream);

      // Wait for completion
      entry.promise
        .then((result: any) => {
          send('done', {
            result: result.result,
            sessionId: result.session_id ?? null,
            costUsd: result.cost_usd,
            durationMs: result.duration_ms,
            usage: result.usage,
            isError: result.is_error,
            error: result.error ?? null,
          });
        })
        .catch((err: any) => {
          const state = getEngineStream(chatId);
          send('failed', { message: err.message || '执行失败', sessionId: state?.backendSessionId || null });
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
      if (engineState.liveSession) {
        void saveChatSession({
          ...engineState.liveSession,
          updatedAt: Date.now(),
        }).catch(() => {});
      }
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
    if (state.liveSession) {
      void saveChatSession({
        ...state.liveSession,
        updatedAt: Date.now(),
      }).catch(() => {});
    }
  }
  processManager.killProcess(chatId);
  return NextResponse.json({ killed: true, preserved: preserveSession });
}
