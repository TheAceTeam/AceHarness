import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { processManager } from '@/lib/core/process-manager';
import {
  executeChatRuntimeWithContextRecovery,
  getOrCreateChatRuntimeEngine,
  isChatRuntimeTimingDebug,
  resolveRecoveredRuntimeSessionId,
  resolveRequestedChatRuntimeEngineType,
  type ChatRuntimeResultMetadata,
  type ChatRuntimeTokenUsage,
} from '@/lib/chat/chat-engine-runtime';
import {
  registerEngineStream,
  appendEngineStreamContent,
  setEngineStreamSessionId,
  setEngineStreamStatus,
  setEngineStreamLiveSession,
  updateEngineStreamLiveSession,
  getEngineStream,
  getEngineStreamByFrontendSessionId,
  getRuntimeSessionIdByFrontendSessionId,
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
import { buildFinalRawContent, appendStreamChunk } from '@/lib/chat/stream-assembly';
import { isSafeAction, normalizeAssistantDisplay, parseActions } from '@/lib/chat/actions';
import { formatAceToolCall, formatAceToolResult } from '@/lib/chat/ace-process-formatters';
import { loadChatSession, saveChatSession, type PersistedChatSession, type PersistedMessage } from '@/lib/chat/persistence';
import { isCreationAssistantSidebarHint, type HomeSidebarHint } from '@/lib/core/home-sidebar-state';
import { normalizeEngineNamespacedSlashCommand } from '@/lib/chat/engine-slash-command';
import { writeAcpxDebugTrace, type AcpxDebugTraceStage } from '@/lib/runtime-agent/acpx-debug-trace';
import {
  buildMemoryV2RecoverySource,
  prepareHomepageChatMemoryV2,
} from '@/lib/memory-v2-cutover/homepage-chat';
import { AiMemoryV2EngineAdapter } from '@/lib/agent/ai-memory-engine-adapter';
import { chatModelRouteError, resolveActiveChatModelRoute } from '@/lib/chat/model-route-validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 1200;
const COMPLETED_STREAM_RETENTION_MS = 2 * 60 * 1000;
const LIVE_SESSION_SAVE_INTERVAL_MS = 5000;

function numberOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function serializeRuntimeToolEvent(tool: any): string {
  if (!tool || typeof tool !== 'object') return '';

  const toolName = stringOrUndefined(tool.toolName) || 'tool';
  const title = stringOrUndefined(tool.title);
  const toolId = stringOrUndefined(tool.id);
  if (tool.status === 'running') {
    return formatAceToolCall({
      toolName,
      title,
      toolId,
      rawInput: tool.input && typeof tool.input === 'object' ? tool.input : undefined,
    });
  }

  if (tool.status === 'completed' || tool.status === 'failed') {
    const rawOutput = tool.result && typeof tool.result === 'object'
      ? tool.result
      : tool.status === 'failed'
        ? { error: '工具调用失败，ACP 未返回详细结果。' }
        : { completed: true, resultUnavailable: true };
    return formatAceToolResult({ toolName, title, toolId, rawOutput });
  }

  return '';
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

function metadataNumber(metadata: ChatRuntimeResultMetadata | undefined, ...keys: string[]): number | undefined {
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

function writeChatStreamDebugTrace(input: {
  stage: AcpxDebugTraceStage;
  chatId?: string;
  frontendSessionId?: string;
  runtimeSessionId?: string;
  requestId?: string;
  traceId?: string;
  payload: unknown;
}): void {
  writeAcpxDebugTrace({
    stage: input.stage,
    context: {
      runtimeSessionId: input.runtimeSessionId,
      frontendSessionId: input.frontendSessionId,
      chatId: input.chatId,
      requestId: input.requestId,
      traceId: input.traceId,
      runtime: 'chat',
    },
    payload: input.payload,
  });
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

function toPublicLiveSession(session: PersistedChatSession | undefined | null): PersistedChatSession | null {
  if (!session) return null;
  const { backendSessionId: _backendSessionId, ...publicSession } = session;
  return publicSession as PersistedChatSession;
}

function buildInitialLiveSessionSnapshot(input: {
  frontendSessionId: string;
  message: string;
  displayMessage?: string;
  engine?: string;
  model: string;
  runtimeSessionId?: string;
  existingSession?: PersistedChatSession | null;
  userId: string;
  userMessageId?: string;
  assistantMessageId?: string;
  skipUserMessage?: boolean;
  creationAssistantEnabled?: boolean;
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
    runtimeSessionId: input.runtimeSessionId || existing?.runtimeSessionId || existing?.backendSessionId,
    workflowBinding: existing?.workflowBinding,
    creationSession: existing?.creationSession,
    agentBinding: existing?.agentBinding,
    sessionWorkbenchState: typeof input.creationAssistantEnabled === 'boolean'
      ? {
          ...(existing?.sessionWorkbenchState || {}),
          creationAssistantEnabled: input.creationAssistantEnabled,
        }
      : existing?.sessionWorkbenchState,
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

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const {
      message,
      displayMessage,
      model,
      engine: perChatEngine,
      sessionId: requestedSessionId,
      runtimeSessionId,
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
      creationAssistantEnabled: requestedCreationAssistantEnabled,
    } = body;
    if (!message?.trim()) {
      return jsonError('消息不能为空', 400);
    }

    const sessionId = typeof runtimeSessionId === 'string' && runtimeSessionId.trim()
      ? runtimeSessionId.trim()
      : (typeof requestedSessionId === 'string' ? requestedSessionId.trim() : '');

    const chatId = `chat-${Date.now()}`;
    const streamPrepT0 = Date.now();
    const useModel = model || '';
    const engineRuntimeDirectory = typeof workingDirectory === 'string' && workingDirectory.trim()
      ? workingDirectory.trim()
      : getWorkspaceRoot();

    const configuredEngine = await resolveRequestedChatRuntimeEngineType(perChatEngine);
    if (useModel && !resolveActiveChatModelRoute(configuredEngine, useModel)) {
      return jsonError(chatModelRouteError(configuredEngine, useModel), 422);
    }

    const isResume = !!sessionId;
    const {
      systemPrompt,
      runtimeSkillNames,
      enabledMcpServers,
      runtimeDatabaseEnv,
      creationAssistantEnabled,
    } = await buildChatRequestContext({
      mode,
      sessionId,
      frontendSessionId,
      workingDirectory,
      extraSystemPrompt,
      requestedSkills: skills as RequestedSkillsInput,
      requestedMcpServers: mcpServers as RequestedMcpServersInput,
      creationAssistantEnabled: typeof requestedCreationAssistantEnabled === 'boolean'
        ? requestedCreationAssistantEnabled
        : undefined,
      personalDir: auth.personalDir,
    });
    let validRuntimeSessionId: string | undefined = undefined;
    if (isResume) {
      validRuntimeSessionId = sessionId;
    }
    const engineCommand = normalizeEngineNamespacedSlashCommand(message, configuredEngine);
    const streamRecoveryKey = resolveStreamRecoveryKey(frontendSessionId, streamScope);
    if (!validRuntimeSessionId && streamRecoveryKey) {
      validRuntimeSessionId = getRuntimeSessionIdByFrontendSessionId(streamRecoveryKey);
    }
    const engine = await getOrCreateChatRuntimeEngine(configuredEngine, streamRecoveryKey || frontendSessionId, auth.id);
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
          runtimeSessionId: validRuntimeSessionId,
          existingSession: canUsePersistedSession(existingSession, auth.id) ? existingSession : null,
          userId: auth.id,
          userMessageId: typeof userMessageId === 'string' ? userMessageId : undefined,
          assistantMessageId: typeof assistantMessageId === 'string' ? assistantMessageId : undefined,
          skipUserMessage: Boolean(skipUserMessage),
          creationAssistantEnabled,
        })
      : null;
    const liveAssistantMessageId = typeof assistantMessageId === 'string' && assistantMessageId.trim()
      ? assistantMessageId.trim()
      : baseLiveSession?.messages.at(-1)?.id;
    if (baseLiveSession) {
      // A newly created homepage session must be persisted before V2 derives
      // its continuity/authorization from the frontend session ID.
      await saveChatSession(baseLiveSession);
    }
    const preparedMemoryV2 = await prepareHomepageChatMemoryV2({
      ownerUserId: auth.id,
      frontendSessionId: typeof frontendSessionId === 'string' ? frontendSessionId : undefined,
      message,
    });
    const memoryEngine = engine
      ? new AiMemoryV2EngineAdapter(
          engine,
          (options) => options.step === 'chat',
          preparedMemoryV2.plan,
          preparedMemoryV2.memoryV2,
        )
      : null;

    if (isChatRuntimeTimingDebug()) {
      console.log(
        `[ACE_TIMING][chat/stream][${chatId}] S0_auth_prompts_pool: ${Date.now() - streamPrepT0}ms (engine=${configuredEngine})`
      );
    }

    // Ensure engine config dir + skills symlink exists in working directory
    if (memoryEngine) {
      await ensureEngineRuntimeSkillsAvailable(configuredEngine, engineRuntimeDirectory, runtimeSkillNames);
    }

    if (engine && isChatRuntimeTimingDebug()) {
      console.log(
        `[ACE_TIMING][chat/stream][${chatId}] S1_ready_before_execute: ${Date.now() - streamPrepT0}ms (symlink+pool)`
      );
    }

    // Non-Claude engines: stream through Engine wrapper events
    if (memoryEngine) {
      registerEngineStream(chatId, streamRecoveryKey, configuredEngine, useModel);
      writeChatStreamDebugTrace({
        stage: 'chat.stream.registered',
        chatId,
        frontendSessionId: streamRecoveryKey || frontendSessionId,
        runtimeSessionId: validRuntimeSessionId,
        requestId: chatId,
        payload: {
          configuredEngine,
          model: useModel,
          streamRecoveryKey,
          frontendSessionId,
          hasValidRuntimeSessionId: Boolean(validRuntimeSessionId),
          shouldTrackLiveSession,
          liveAssistantMessageId,
        },
      });
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
        if (evt?.type === 'text' && evt.content) {
          appendEngineStreamContent(chatId, evt.content);
          const stateAfterAppend = getEngineStream(chatId);
          writeChatStreamDebugTrace({
            stage: 'chat.stream.append',
            chatId,
            frontendSessionId: streamRecoveryKey || frontendSessionId,
            runtimeSessionId: stateAfterAppend?.runtimeSessionId || validRuntimeSessionId,
            requestId: chatId,
            traceId: stateAfterAppend?.traceId,
            payload: {
              eventType: evt.type,
              content: evt.content,
              appendedLength: String(evt.content || '').length,
              streamContentLength: String(stateAfterAppend?.streamContent || '').length,
              streamContentPreview: String(stateAfterAppend?.streamContent || '').slice(0, 200),
              streamContentTail: String(stateAfterAppend?.streamContent || '').slice(-200),
            },
          });
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
                runtimeSessionId: getEngineStream(chatId)?.runtimeSessionId || session.runtimeSessionId,
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
        } else if (evt?.type === 'tool' && evt.tool) {
          const toolContent = serializeRuntimeToolEvent(evt.tool);
          if (!toolContent) return;

          appendEngineStreamContent(chatId, toolContent);
          processManager.appendStreamContent(chatId, toolContent);
          if (baseLiveSession && liveAssistantMessageId) {
            const nextLiveSession = updateEngineStreamLiveSession(chatId, (session) => {
              if (!session) return session;
              const currentAssistant = getMessageById(session.messages, liveAssistantMessageId);
              if (!currentAssistant) return session;
              const nextRawContent = appendStreamChunk(String(currentAssistant.rawContent || ''), toolContent);
              const visibleText = normalizeAssistantDisplay(nextRawContent, true).visibleText || parseActions(nextRawContent).text;
              return {
                ...session,
                updatedAt: Date.now(),
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
          engineStreamEvents.emit(chatId, { type: 'delta', content: toolContent });
        } else if (evt?.type === 'session' && evt.content) {
          setEngineStreamSessionId(chatId, evt.content);
          if (proc) proc.sessionId = evt.content;
          const stateAfterSession = getEngineStream(chatId);
          writeChatStreamDebugTrace({
            stage: 'chat.stream.session',
            chatId,
            frontendSessionId: streamRecoveryKey || frontendSessionId,
            runtimeSessionId: String(evt.content),
            requestId: chatId,
            traceId: stateAfterSession?.traceId,
            payload: {
              content: evt.content,
              streamContentLength: String(stateAfterSession?.streamContent || '').length,
              status: stateAfterSession?.status,
            },
          });
          if (baseLiveSession) {
            const nextLiveSession = updateEngineStreamLiveSession(chatId, (session) => {
              if (!session) return session;
              return {
                ...session,
                runtimeSessionId: String(evt.content),
                updatedAt: Date.now(),
              };
            });
            saveLiveSessionSnapshot(nextLiveSession, { force: true });
          }
          engineStreamEvents.emit(chatId, { type: 'session', runtimeSessionId: evt.content, sessionId: evt.content });
        } else if (evt?.type === 'thought' && evt.content) {
          const stateAtThought = getEngineStream(chatId);
          writeChatStreamDebugTrace({
            stage: 'chat.stream.thought',
            chatId,
            frontendSessionId: streamRecoveryKey || frontendSessionId,
            runtimeSessionId: stateAtThought?.runtimeSessionId || validRuntimeSessionId,
            requestId: chatId,
            traceId: stateAtThought?.traceId,
            payload: {
              content: evt.content,
              contentLength: String(evt.content || '').length,
            },
          });
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
          const stateAtError = getEngineStream(chatId);
          writeChatStreamDebugTrace({
            stage: 'chat.stream.error',
            chatId,
            frontendSessionId: streamRecoveryKey || frontendSessionId,
            runtimeSessionId: stateAtError?.runtimeSessionId || validRuntimeSessionId,
            requestId: chatId,
            traceId: stateAtError?.traceId,
            payload: {
              content: evt.content,
            },
          });
          engineStreamEvents.emit(chatId, { type: 'engine_error', content: evt.content });
        }
      };

      memoryEngine.on('stream', onEngineStream);

      const startedAt = Date.now();
      const execPromise = executeChatRuntimeWithContextRecovery(memoryEngine, {
        agent: 'chat',
        step: 'chat',
        prompt: engineCommand.prompt,
        systemPrompt,
        model: useModel,
        workingDirectory: engineRuntimeDirectory,
        sessionId: validRuntimeSessionId,
        appendSystemPrompt: !!validRuntimeSessionId && !!systemPrompt,
        mcpServers: enabledMcpServers,
        userId: auth.id,
        rawPrompt: engineCommand.rawPrompt,
        env: runtimeDatabaseEnv,
      }, {
        buildCompactSource: () => buildMemoryV2RecoverySource({
          promptBlock: memoryEngine.getLatestMemoryV2PromptBlock(),
          currentRequest: engineCommand.prompt,
        }),
        onContextReset: () => {
          engineStreamEvents.emit(chatId, { type: 'engine_error', content: '上下文超限，已清空会话并自动接力继续。' });
        },
      }).then((result) => {
        if (isChatRuntimeTimingDebug()) {
          console.log(
            `[ACE_TIMING][chat/stream][${chatId}] S2_engine_execute_wall: ${Date.now() - startedAt}ms (platform overhead ≈ S1; agent+ACP ≈ wrap.W4 / acp.6)`
          );
        }
        const resolvedRuntimeSessionId = resolveRecoveredRuntimeSessionId(result, validRuntimeSessionId);
        setEngineStreamSessionId(chatId, resolvedRuntimeSessionId || undefined);
        if (proc) proc.sessionId = resolvedRuntimeSessionId || undefined;
        const state = getEngineStream(chatId);
        const streamedContent = String(state?.streamContent || '');
        const output = buildFinalRawContent(streamedContent, '', String(result.output || ''))
          || String(result.output || streamedContent || '');

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
          runtimeSessionId: resolvedRuntimeSessionId ?? null,
          session_id: resolvedRuntimeSessionId ?? null,
          cost_usd: metadataNumber(metadata, 'cost_usd', 'costUsd') ?? 0,
          duration_ms: metadataNumber(metadata, 'duration_ms', 'durationMs') ?? (Date.now() - startedAt),
          usage: normalizeUsage(metadata),
          is_error: !result.success,
          error: result.error || undefined,
        };
        writeChatStreamDebugTrace({
          stage: 'chat.stream.final_payload',
          chatId,
          frontendSessionId: streamRecoveryKey || frontendSessionId,
          runtimeSessionId: resolvedRuntimeSessionId || validRuntimeSessionId,
          requestId: chatId,
          traceId: state?.traceId,
          payload: {
            success: result.success,
            output,
            outputLength: String(output || '').length,
            stateStreamContentLength: String(state?.streamContent || '').length,
            stateStreamContentPreview: String(state?.streamContent || '').slice(0, 200),
            stateStreamContentTail: String(state?.streamContent || '').slice(-200),
            responsePayload: {
              result: responsePayload.result,
              runtimeSessionId: responsePayload.runtimeSessionId,
              duration_ms: responsePayload.duration_ms,
              usage: responsePayload.usage,
              is_error: responsePayload.is_error,
              error: responsePayload.error,
            },
          },
        });
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
                runtimeSessionId: resolvedRuntimeSessionId || session.runtimeSessionId,
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
            const candidateSidebarHint = parsed.sidebarHints[parsed.sidebarHints.length - 1];
            const latestSidebarHint: HomeSidebarHint | undefined = !creationAssistantEnabled
              && isCreationAssistantSidebarHint(candidateSidebarHint)
              ? undefined
              : candidateSidebarHint;
            const actionStates = parsed.actions.map((action) => ({
              id: genId(),
              action,
              status: isSafeAction(action) ? 'auto_executing' : 'pending',
              timestamp: now,
            }));
            return {
              ...session,
              runtimeSessionId: resolvedRuntimeSessionId || session.runtimeSessionId,
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
            const failedRuntimeSessionId = getEngineStream(chatId)?.runtimeSessionId || proc?.sessionId || validRuntimeSessionId || session.runtimeSessionId;
            const errorContent = partial
              ? `请求失败：${message}\n\n已返回部分内容：\n${partial}`
              : `请求失败：${message}`;
            return {
              ...session,
              runtimeSessionId: failedRuntimeSessionId,
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
        memoryEngine.off('stream', onEngineStream);
        memoryEngine.releaseMemoryV2();
      });

      const entry = {
        promise: execPromise,
        settled: false,
        chatId,
        cancel: () => {
          setEngineStreamStatus(chatId, 'killed');
          memoryEngine.cancel();
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

      return jsonOk({ chatId });
    }

    // All engines (including claude-code) should be handled above via the chat runtime bridge.
    // If engine is null, it means the engine is not available.
    return jsonError('引擎不可用，请检查配置', 500);
  } catch (error: any) {
    return jsonError(errorMessage(error) || '启动失败', 500);
  }
}
export async function GET(request: Request) {
  const chatId = requestUrl(request).searchParams.get('id');
  const checkSession = requestUrl(request).searchParams.get('checkActive');
  const streamScope = requestUrl(request).searchParams.get('streamScope') || undefined;

  // Check if a frontend session has an active stream
  if (checkSession) {
    const recoveryKey = resolveStreamRecoveryKey(checkSession, streamScope);
    const engineState = recoveryKey ? getEngineStreamByFrontendSessionId(recoveryKey) : undefined;
    if (engineState) {
      writeChatStreamDebugTrace({
        stage: 'chat.stream.check_active',
        chatId: engineState.chatId,
        frontendSessionId: recoveryKey || checkSession,
        runtimeSessionId: engineState.runtimeSessionId,
        requestId: engineState.chatId,
        traceId: engineState.traceId,
        payload: {
          source: 'engine_state',
          active: engineState.status === 'running',
          found: true,
          status: engineState.status,
          engine: engineState.engine || '',
          model: engineState.model || '',
          streamContent: engineState.streamContent || '',
          streamContentLength: String(engineState.streamContent || '').length,
          streamContentPreview: String(engineState.streamContent || '').slice(0, 200),
          streamContentTail: String(engineState.streamContent || '').slice(-200),
          hasLiveSession: Boolean(engineState.liveSession),
        },
      });
      return jsonOk({
        active: engineState.status === 'running',
        found: true,
        chatId: engineState.chatId,
        streamContent: engineState.streamContent || '',
        status: engineState.status,
        engine: engineState.engine || '',
        model: engineState.model || '',
        runtimeSessionId: engineState.runtimeSessionId || '',
        turnId: engineState.turnId || '',
        traceId: engineState.traceId || '',
        liveSession: toPublicLiveSession(engineState.liveSession),
      });
    }

    const activeChatId = recoveryKey ? processManager.getActiveStreamChatId(recoveryKey) : undefined;
    if (activeChatId && activeChats.has(activeChatId)) {
      const proc = processManager.getProcess(activeChatId);
      writeChatStreamDebugTrace({
        stage: 'chat.stream.check_active',
        chatId: activeChatId,
        frontendSessionId: recoveryKey || checkSession,
        runtimeSessionId: proc?.sessionId,
        requestId: activeChatId,
        payload: {
          source: 'process_manager',
          active: true,
          found: true,
          status: proc?.status || 'running',
          streamContent: proc?.streamContent || '',
          streamContentLength: String(proc?.streamContent || '').length,
          streamContentPreview: String(proc?.streamContent || '').slice(0, 200),
          streamContentTail: String(proc?.streamContent || '').slice(-200),
        },
      });
      return jsonOk({
        active: true,
        found: true,
        chatId: activeChatId,
        streamContent: proc?.streamContent || '',
        status: proc?.status || 'running',
        engine: '',
        model: '',
      });
    }
    writeChatStreamDebugTrace({
      stage: 'chat.stream.check_active',
      frontendSessionId: recoveryKey || checkSession,
      requestId: recoveryKey || checkSession,
      payload: {
        source: 'none',
        active: false,
        found: false,
      },
    });
    return jsonOk({ active: false });
  }

  if (!chatId) {
    return jsonError('Missing id', 400);
  }

  const entry = activeChats.get(chatId);
  if (!entry) {
    return jsonError('Chat not found', 404);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          const state = getEngineStream(chatId);
          writeChatStreamDebugTrace({
            stage: 'chat.stream.sse_send',
            chatId,
            frontendSessionId: state?.frontendSessionId,
            runtimeSessionId: state?.runtimeSessionId || stringOrUndefined(data?.runtimeSessionId) || stringOrUndefined(data?.sessionId),
            requestId: chatId,
            traceId: state?.traceId,
            payload: {
              event,
              data,
              streamContentLength: String(state?.streamContent || '').length,
              streamContentPreview: String(state?.streamContent || '').slice(0, 200),
              streamContentTail: String(state?.streamContent || '').slice(-200),
            },
          });
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
          send('session', { runtimeSessionId: evt.runtimeSessionId || evt.sessionId, sessionId: evt.runtimeSessionId || evt.sessionId });
        } else if (evt.type === 'thinking') {
          send('thinking', { content: evt.content });
        } else if (evt.type === 'engine_error') {
          const state = getEngineStream(chatId);
          send('engine_error', { message: evt.content || '执行失败', runtimeSessionId: state?.runtimeSessionId || null });
        }
      };

      send('connected', { chatId });
      const state = getEngineStream(chatId);
      if (state?.runtimeSessionId) {
        send('session', { runtimeSessionId: state.runtimeSessionId, sessionId: state.runtimeSessionId });
      }
      engineStreamEvents.on(chatId, onEngineStream);

      // Wait for completion
      entry.promise
        .then((result: any) => {
          send('done', {
            result: result.result,
            runtimeSessionId: result.runtimeSessionId ?? result.session_id ?? null,
            sessionId: result.runtimeSessionId ?? result.session_id ?? null,
            costUsd: result.cost_usd,
            durationMs: result.duration_ms,
            usage: result.usage,
            isError: result.is_error,
            error: result.error ?? null,
          });
        })
        .catch((err: any) => {
          const state = getEngineStream(chatId);
          send('failed', { message: err.message || '执行失败', runtimeSessionId: state?.runtimeSessionId || null });
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

export async function DELETE(request: Request) {
  const frontendSessionId = requestUrl(request).searchParams.get('frontendSessionId');
  const streamScope = requestUrl(request).searchParams.get('streamScope') || undefined;
  const preserveSession = requestUrl(request).searchParams.get('preserveSession') === '1';
  if (frontendSessionId) {
    const recoveryKey = resolveStreamRecoveryKey(frontendSessionId, streamScope);
    const engineState = recoveryKey ? getEngineStreamByFrontendSessionId(recoveryKey) : undefined;
    const activeChatId = engineState?.chatId || (recoveryKey ? processManager.getActiveStreamChatId(recoveryKey) : undefined);
    if (!activeChatId) {
      return jsonOk({ killed: true, count: 0 });
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
    return jsonOk({ killed: true, count: 1, chatId: activeChatId, preserved: preserveSession });
  }

  const chatId = requestUrl(request).searchParams.get('id');
  if (!chatId) {
    return jsonError('Missing id', 400);
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
  return jsonOk({ killed: true, preserved: preserveSession });
}
