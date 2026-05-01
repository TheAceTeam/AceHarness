import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';
import { getOrCreateEngine, getConfiguredEngine } from '@/lib/engines/engine-factory';
import { getEngineConfigDir } from '@/lib/engines/engine-config';
import { buildDashboardSystemPrompt } from '@/lib/chat-system-prompt';
import { loadChatSettings } from '@/lib/chat-settings';
import type { Engine } from '@/lib/engines/engine-interface';
import {
  registerEngineStream,
  appendEngineStreamContent,
  setEngineStreamSessionId,
  setEngineStreamStatus,
  getEngineStream,
  getEngineStreamByFrontendSessionId,
  removeEngineStream,
} from '@/lib/chat-stream-state';
import { getRepoRoot, getWorkspaceDataFile, getWorkspaceRoot } from '@/lib/app-paths';
import { getRuntimeSkillsDirPath } from '@/lib/runtime-skills';
import { loadChatSession } from '@/lib/chat-persistence';
import { loadCreationSession } from '@/lib/spec-coding-store';
import { workflowRegistry } from '@/lib/workflow-registry';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { EventEmitter } from 'events';

export const dynamic = 'force-dynamic';

const DEFAULT_PROMPT = '你是一个 AI 助手，简洁回答问题。';

const SESSIONS_DIR = getWorkspaceDataFile('chat-sessions');
const MAX_HISTORY_CHARS = 6000;

/**
 * Load chat history from a frontend session file and format as context summary.
 * Returns empty string if session not found or no messages.
 */
async function loadChatHistory(frontendSessionId: string): Promise<string> {
  try {
    const filePath = resolve(SESSIONS_DIR, `${frontendSessionId}.json`);
    const content = await readFile(filePath, 'utf-8');
    const session = JSON.parse(content);
    const messages: { role: string; content: string }[] = session.messages || [];
    if (messages.length === 0) return '';

    // Build a condensed history: keep role + truncated content
    let history = '';
    for (const msg of messages) {
      if (!msg.content) continue;
      const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : '系统';
      // Truncate long messages, remove action/result card blocks to save tokens
      let text = msg.content
        .replace(/<result>\s*```(?:card|json)\s*\n[\s\S]*?```\s*<\/result>/g, '[result block]')
        .replace(/```(?:action|card)\s*\n[\s\S]*?```/g, '[action/card block]')
        .replace(/<\/?result>/g, '')
        .trim();
      if (text.length > 500) text = text.slice(0, 500) + '...';
      history += `${role}: ${text}\n\n`;
      if (history.length > MAX_HISTORY_CHARS) break;
    }
    if (!history) return '';
    return `\n\n## 之前的对话记录（会话已过期重建，以下是历史上下文）\n${history.slice(0, MAX_HISTORY_CHARS)}`;
  } catch {
    return '';
  }
}

async function buildBoundSessionContext(frontendSessionId?: string): Promise<string> {
  if (!frontendSessionId) return '';

  try {
    const session = await loadChatSession(frontendSessionId);
    if (!session) return '';

    const sections: string[] = [];

    if (session.creationSession) {
      const creationRecord = await loadCreationSession(session.creationSession.creationSessionId);
      const specCoding = creationRecord?.specCoding;
      const latestRevision = specCoding?.revisions?.at(-1);

      sections.push([
        '### 创建态绑定',
        `- 工作流: ${session.creationSession.workflowName}`,
        `- 配置文件: ${session.creationSession.filename}`,
        `- 创建状态: ${session.creationSession.status}`,
        `- SpecCoding ID: ${session.creationSession.specCodingId}`,
        specCoding ? `- SpecCoding 版本: v${specCoding.version}` : '',
        specCoding?.status ? `- SpecCoding 状态: ${specCoding.status}` : '',
        specCoding?.summary ? `- SpecCoding 摘要: ${specCoding.summary}` : '',
        specCoding?.progress?.summary ? `- SpecCoding 进度: ${specCoding.progress.summary}` : '',
        latestRevision?.summary ? `- 最近修订: ${latestRevision.summary}` : '',
      ].filter(Boolean).join('\n'));
    }

    if (session.workflowBinding) {
      const manager = await workflowRegistry.getManager(session.workflowBinding.configFile);
      const status = manager.getStatus();
      const runState = session.workflowBinding.runId
        ? await import('@/lib/run-state-persistence').then((mod) => mod.loadRunState(session.workflowBinding!.runId)).catch(() => null)
        : null;
      const specCoding = runState?.runSpecCoding || null;
      const latestRevision = specCoding?.revisions?.at(-1);

      sections.push([
        '### 运行态绑定',
        `- 配置文件: ${session.workflowBinding.configFile}`,
        `- Run ID: ${session.workflowBinding.runId}`,
        `- 当前 Supervisor: ${session.workflowBinding.supervisorAgent || 'default-supervisor'}`,
        session.workflowBinding.supervisorSessionId ? `- Supervisor Session: ${session.workflowBinding.supervisorSessionId}` : '',
        status?.status ? `- 运行状态: ${status.status}` : '',
        status?.currentPhase ? `- 当前阶段: ${status.currentPhase}` : '',
        status?.currentStep ? `- 当前步骤: ${status.currentStep}` : '',
        specCoding ? `- 运行关联 SpecCoding: v${specCoding.version} / ${specCoding.status}` : '',
        specCoding?.progress?.summary ? `- SpecCoding 执行进度: ${specCoding.progress.summary}` : '',
        latestRevision?.summary ? `- SpecCoding 最近修订: ${latestRevision.summary}` : '',
      ].filter(Boolean).join('\n'));
    }

    if (sections.length === 0) return '';

    return [
      '## 当前会话绑定上下文',
      '以下信息来自当前首页会话已绑定的创建态或运行态上下文。用户未明确切换对象时，默认优先基于这些绑定对象回答，不要反复追问“是哪个 workflow / supervisor”。',
      ...sections,
    ].join('\n\n');
  } catch {
    return '';
  }
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
  try {
    const {
      message,
      model,
      engine: perChatEngine,
      sessionId,
      frontendSessionId,
      mode,
      workingDirectory,
      extraSystemPrompt,
    } = await request.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const chatId = `chat-${Date.now()}`;
    const useModel = model || '';

    // On resume, skip full system prompt (session already has it).
    // Only send a lightweight skill-status reminder if skills changed.
    let systemPrompt = '';
    const isResume = !!sessionId;
    if (mode === 'dashboard') {
      const settings = await loadChatSettings();
      const enabledSkills = Object.entries(settings.skills)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (isResume) {
        // Lightweight reminder — just list enabled skill names
        systemPrompt = enabledSkills.length > 0
          ? `当前启用的 Skills: ${enabledSkills.join(', ')}。需要时查阅 skills/{skill-name}/SKILL.md。`
          : '';
      } else {
        const requiredSkills = ['aceharness-workflow-creator'];
        const merged = [...enabledSkills];
        for (const s of requiredSkills) {
          if (!merged.includes(s)) merged.push(s);
        }
        systemPrompt = await buildDashboardSystemPrompt(merged);
      }
    } else if (!isResume) {
      systemPrompt = DEFAULT_PROMPT;
    }

    // If resuming, trust the session ID directly — don't waste 10s on a probe.
    // If the session is actually expired, Claude CLI will fail fast and we retry
    // as a new session with history injection.
    let validResumeSid: string | undefined = undefined;
    if (isResume) {
      validResumeSid = sessionId;
    }

    const chatSettings = mode === 'dashboard' ? await loadChatSettings() : null;
    const requestedWorkingDirectory = typeof workingDirectory === 'string' ? workingDirectory.trim() : '';
    const engineRuntimeDirectory = getWorkspaceRoot();
    const resolvedWorkingDirectory = requestedWorkingDirectory || chatSettings?.workingDirectory || engineRuntimeDirectory;
    const runtimeEnvPrompt = [
      '## 运行目录信息',
      `ACEFlow 安装目录: ${getRepoRoot()}`,
      `ACEHarness 运行时根目录: ${engineRuntimeDirectory}`,
      `当前工作目录(用户语义目录): ${resolvedWorkingDirectory}`,
      `AI 运行目录(实际 cwd): ${engineRuntimeDirectory}`,
      '执行文件读写/命令时，请优先基于“当前工作目录(用户语义目录)”使用绝对路径。',
    ].join('\n');
    const boundSessionPrompt = await buildBoundSessionContext(frontendSessionId);
    systemPrompt = `${systemPrompt}\n\n${runtimeEnvPrompt}${boundSessionPrompt ? `\n\n${boundSessionPrompt}` : ''}${typeof extraSystemPrompt === 'string' && extraSystemPrompt.trim() ? `\n\n${extraSystemPrompt.trim()}` : ''}`.trim();
    const configuredEngine = perChatEngine || await getConfiguredEngine();
    const engine = await getOrCreateEngine(configuredEngine, frontendSessionId);

    // Ensure engine config dir + skills symlink exists in working directory
    if (engine) {
      const workDir = engineRuntimeDirectory;
      try {
        const { existsSync, mkdirSync, symlinkSync } = await import('fs');
        const { join, resolve } = await import('path');
        const engineConfigDir = getEngineConfigDir(configuredEngine);
        const configDir = join(resolve(workDir), engineConfigDir);
        const skillsDir = await getRuntimeSkillsDirPath();
        if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
        const skillsLink = join(configDir, 'skills');
        if (existsSync(skillsDir) && !existsSync(skillsLink)) {
          symlinkSync(skillsDir, skillsLink);
        }
      } catch { /* ignore */ }
    }

    // Non-Claude engines: stream through Engine wrapper events
    if (engine) {
      registerEngineStream(chatId, frontendSessionId, configuredEngine, useModel);

      // Register in processManager so recovery endpoint can find it
      const proc = processManager.registerExternalProcess(chatId, 'chat', 'chat');
      if (frontendSessionId) {
        proc.frontendSessionId = frontendSessionId;
        processManager.registerActiveStream(frontendSessionId, chatId);
      }

      const onEngineStream = (evt: any) => {
        if ((evt?.type === 'text' || evt?.type === 'tool') && evt.content) {
          appendEngineStreamContent(chatId, evt.content);
          processManager.appendStreamContent(chatId, evt.content);
          engineStreamEvents.emit(chatId, { type: 'delta', content: evt.content });
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

        return {
          result: output,
          session_id: result.sessionId,
          cost_usd: 0,
          duration_ms: Date.now() - startedAt,
          usage: undefined,
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
            if (frontendSessionId) processManager.removeActiveStream(frontendSessionId);
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

  // Check if a frontend session has an active stream
  if (checkSession) {
    const engineState = getEngineStreamByFrontendSessionId(checkSession);
    if (engineState && engineState.status === 'running') {
      return NextResponse.json({
        active: true,
        chatId: engineState.chatId,
        streamContent: engineState.streamContent || '',
        status: engineState.status,
        engine: engineState.engine || '',
        model: engineState.model || '',
      });
    }

    const activeChatId = processManager.getActiveStreamChatId(checkSession);
    if (activeChatId && activeChats.has(activeChatId)) {
      const proc = processManager.getProcess(activeChatId);
      return NextResponse.json({
        active: true,
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
        } else if (evt.type === 'thinking') {
          send('thinking', { content: evt.content });
        } else if (evt.type === 'engine_error') {
          send('engine_error', { message: evt.content || '执行失败' });
        }
      };

      const state = getEngineStream(chatId);
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
  const chatId = request.nextUrl.searchParams.get('id');
  if (!chatId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const entry = activeChats.get(chatId);
  if (entry?.cancel) {
    entry.cancel();
  }
  activeChats.delete(chatId);
  removeEngineStream(chatId);
  processManager.killProcess(chatId);
  return NextResponse.json({ killed: true });
}
