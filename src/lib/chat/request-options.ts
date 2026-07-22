import { existsSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { loadChatSettings, type ChatSettings } from '@/lib/chat/settings';
import {
  buildDashboardConversationSystemPrompt,
  buildDashboardSystemPrompt,
} from '@/lib/chat/system-prompt';
import { getWorkspaceAgentConfigDir, getWorkspaceRoot } from '@/lib/core/app-paths';
import { loadChatSession } from '@/lib/chat/persistence';
import { resolveCreationAssistantEnabled } from '@/lib/core/home-sidebar-state';
import { loadCreationSession } from '@/lib/spec/coding-store';
import { workflowRegistry } from '@/lib/workflow/registry';
import { resolveMcpServersByNames, type ManagedMcpServer } from '@/lib/mcp/registry';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { createDirectoryLinkSync, isLinkedDirectoryTarget } from '@/lib/core/directory-links';
import {
  buildDatabaseCapabilityPrompt,
  buildRuntimeDatabaseEnv,
  createRuntimeDatabaseGrant,
  expandCapabilitySkillNames,
  writeRuntimeDatabaseEnvFile,
} from '@/lib/runtime/database-capabilities';

const DEFAULT_PROMPT = '你是一个 AI 助手，简洁回答问题。';
const MAX_HISTORY_CHARS = 6000;
const REQUIRED_DASHBOARD_SKILLS = ['aceharness-workflow-creator'];

export type RequestedSkillsInput = string[] | Record<string, boolean> | undefined;
export type RequestedMcpServersInput = string[] | Record<string, boolean> | undefined;

function normalizeRequestedSkills(
  input: RequestedSkillsInput,
  discoveredNames: Set<string>
): string[] | undefined {
  if (!input) return undefined;

  if (Array.isArray(input)) {
    const names = input
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && discoveredNames.has(item));
    return Array.from(new Set(names));
  }

  if (typeof input === 'object') {
    const names = Object.entries(input)
      .filter(([name, enabled]) => Boolean(enabled) && discoveredNames.has(name))
      .map(([name]) => name);
    return Array.from(new Set(names));
  }

  return undefined;
}

function resolveEnabledSkills(
  settings: ChatSettings,
  requestedSkills: RequestedSkillsInput
): string[] {
  const discoveredNames = new Set(Object.keys(settings.skills || {}));
  const requestScopedSkills = normalizeRequestedSkills(requestedSkills, discoveredNames);
  if (requestScopedSkills) return requestScopedSkills;

  return Object.entries(settings.skills || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name);
}

function normalizeRequestedMcpServers(
  input: RequestedMcpServersInput,
  discoveredNames: Set<string>
): string[] | undefined {
  if (!input) return undefined;

  if (Array.isArray(input)) {
    const names = input
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && discoveredNames.has(item));
    return Array.from(new Set(names));
  }

  if (typeof input === 'object') {
    const names = Object.entries(input)
      .filter(([name, enabled]) => Boolean(enabled) && discoveredNames.has(name))
      .map(([name]) => name);
    return Array.from(new Set(names));
  }

  return undefined;
}

async function resolveEnabledMcpServers(
  settings: ChatSettings,
  requestedMcpServers: RequestedMcpServersInput,
  baseDirectory?: string,
): Promise<ManagedMcpServer[]> {
  const discoveredServers = await resolveMcpServersByNames(Object.keys(settings.mcpServers || {}), baseDirectory);
  const discoveredNames = new Set(discoveredServers.map((server) => server.name));
  const requestScopedNames = normalizeRequestedMcpServers(requestedMcpServers, discoveredNames);
  if (requestScopedNames) {
    return resolveMcpServersByNames(requestScopedNames, baseDirectory);
  }

  const enabledNames = Object.entries(settings.mcpServers || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name);
  return resolveMcpServersByNames(enabledNames, baseDirectory);
}

export async function resolveChatRequestedMcpServers(options: {
  requestedMcpServers?: RequestedMcpServersInput;
  workingDirectory?: string;
}): Promise<ManagedMcpServer[]> {
  const chatSettings = await loadChatSettings();
  const requestedWorkingDirectory = typeof options.workingDirectory === 'string'
    ? options.workingDirectory.trim()
    : '';
  const resolvedWorkingDirectory = requestedWorkingDirectory || chatSettings.workingDirectory || getWorkspaceRoot();
  return resolveEnabledMcpServers(chatSettings, options.requestedMcpServers, resolvedWorkingDirectory);
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
        ? await import('@/lib/run/state-persistence').then((mod) => mod.loadRunState(session.workflowBinding!.runId)).catch(() => null)
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

export async function loadChatHistory(frontendSessionId: string): Promise<string> {
  try {
    const session = await loadChatSession(frontendSessionId);
    if (!session) return '';
    const messages: { role: string; content: string }[] = session.messages || [];
    if (messages.length === 0) return '';

    let history = '';
    for (const msg of messages) {
      const source = String(msg.content || (msg as any).rawContent || '').trim();
      if (!source) continue;
      const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : '系统';
      let text = source
        .replace(/<result>[\s\S]*?<\/result>/gi, '[result block]')
        .replace(/```(?:action|card)\s*\n[\s\S]*?```/g, '[action/card block]')
        .replace(/<\/?result>/g, '')
        .trim();
      if (text.length > 500) text = `${text.slice(0, 500)}...`;
      history += `${role}: ${text}\n\n`;
      if (history.length > MAX_HISTORY_CHARS) break;
    }
    if (!history) return '';
    return `\n\n## 之前的对话记录（会话已过期重建，以下是历史上下文）\n${history.slice(0, MAX_HISTORY_CHARS)}`;
  } catch {
    return '';
  }
}

export async function buildChatRequestContext(options: {
  mode?: string;
  sessionId?: string;
  frontendSessionId?: string;
  workingDirectory?: string;
  extraSystemPrompt?: string;
  requestedSkills?: RequestedSkillsInput;
  requestedMcpServers?: RequestedMcpServersInput;
  creationAssistantEnabled?: boolean;
  personalDir?: string;
}): Promise<{
  systemPrompt: string;
  resolvedWorkingDirectory: string;
  chatSettings: ChatSettings | null;
  enabledSkills: string[];
  runtimeSkillNames: string[];
  enabledMcpServers: ManagedMcpServer[];
  runtimeDatabaseEnv: Record<string, string>;
  creationAssistantEnabled: boolean;
}> {
  const {
    mode,
    sessionId,
    frontendSessionId,
    workingDirectory,
    extraSystemPrompt,
    requestedSkills,
    requestedMcpServers,
    creationAssistantEnabled: requestedCreationAssistantEnabled,
    personalDir,
  } = options;

  const isResume = Boolean(sessionId);
  const chatSettings = mode === 'dashboard' ? await loadChatSettings() : null;
  const persistedSession = mode === 'dashboard' && frontendSessionId && requestedCreationAssistantEnabled === undefined
    ? await loadChatSession(frontendSessionId).catch(() => null)
    : null;
  const creationAssistantEnabled = mode === 'dashboard'
    ? requestedCreationAssistantEnabled ?? resolveCreationAssistantEnabled(persistedSession)
    : false;
  const configuredSkills = chatSettings
    ? expandCapabilitySkillNames(resolveEnabledSkills(chatSettings, requestedSkills), chatSettings.capabilitySkills)
    : [];
  const enabledSkills = creationAssistantEnabled
    ? configuredSkills
    : configuredSkills.filter((skillName) => !REQUIRED_DASHBOARD_SKILLS.includes(skillName));
  const requestedWorkingDirectory = typeof workingDirectory === 'string' ? workingDirectory.trim() : '';
  const engineRuntimeDirectory = getWorkspaceRoot();
  const resolvedWorkingDirectory = requestedWorkingDirectory || chatSettings?.workingDirectory || engineRuntimeDirectory;
  const enabledMcpServers = chatSettings
    ? await resolveEnabledMcpServers(chatSettings, requestedMcpServers, resolvedWorkingDirectory)
    : [];
  const runtimeDatabaseGrant = chatSettings
    ? await createRuntimeDatabaseGrant({
      capabilitySkills: chatSettings.capabilitySkills,
      skills: enabledSkills,
      workspaceRoot: resolvedWorkingDirectory,
      chatSessionId: frontendSessionId || sessionId,
    })
    : null;
  await writeRuntimeDatabaseEnvFile(runtimeDatabaseGrant);
  const runtimeDatabaseEnv = buildRuntimeDatabaseEnv(runtimeDatabaseGrant);

  let systemPrompt = '';
  let runtimeSkillNames: string[] = [];
  if (mode === 'dashboard') {
    const dashboardSkills = [...enabledSkills];
    if (creationAssistantEnabled) {
      for (const skillName of REQUIRED_DASHBOARD_SKILLS) {
        if (!dashboardSkills.includes(skillName)) dashboardSkills.push(skillName);
      }
    }
    if (isResume) {
      const modeReminder = creationAssistantEnabled
        ? '当前会话已启用创建助手模式。创建 workflow 或 Agent 时，必须使用 aceharness-workflow-creator，并在回复最后输出 `<result>` 包裹的 `home_sidebar` JSON；需要打开创建弹窗时设置 `shouldOpenModal:true`。'
        : '当前会话是普通工程对话模式。不要使用 aceharness-workflow-creator，不要输出 `intent=create-workflow` 或 `intent=create-agent` 的 `home_sidebar`，也不要触发 workflow / Agent 创建弹窗。';
      systemPrompt = dashboardSkills.length > 0
        ? [
          modeReminder,
          `当前启用的 Skills: ${dashboardSkills.join(', ')}。需要时查阅 skills/{skill-name}/SKILL.md。`,
          dashboardSkills.includes('aceharness-chat-card')
            ? '当用户查看/列出/统计 workflow、Agent、模型、运行记录、状态或其他 API 查询结果时，优先在回复末尾输出 `<result>{"kind":"card","payload":{...}}</result>`；列表优先用 table，不要只用纯文本复述长列表。'
            : '',
        ].filter(Boolean).join('\n')
        : modeReminder;
      runtimeSkillNames = [...dashboardSkills];
      const skillsDir = await getRuntimeSkillsDirPath();
      const dbPrompt = buildDatabaseCapabilityPrompt(runtimeDatabaseGrant, skillsDir);
      if (dbPrompt) {
        systemPrompt = `${systemPrompt}${systemPrompt ? '\n\n' : ''}${dbPrompt}`.trim();
      }
    } else {
      runtimeSkillNames = [...dashboardSkills];
      const promptOptions = { personalDir, workingDirectory: resolvedWorkingDirectory };
      systemPrompt = creationAssistantEnabled
        ? await buildDashboardSystemPrompt(dashboardSkills, promptOptions)
        : await buildDashboardConversationSystemPrompt(dashboardSkills, promptOptions);
      const skillsDir = await getRuntimeSkillsDirPath();
      const dbPrompt = buildDatabaseCapabilityPrompt(runtimeDatabaseGrant, skillsDir);
      if (dbPrompt) {
        systemPrompt = `${systemPrompt}\n\n${dbPrompt}`.trim();
      }
    }
  } else if (!isResume) {
    systemPrompt = DEFAULT_PROMPT;
  }

  const boundSessionPrompt = await buildBoundSessionContext(frontendSessionId);
  const extraPrompt = typeof extraSystemPrompt === 'string' ? extraSystemPrompt.trim() : '';

  systemPrompt = `${systemPrompt}${boundSessionPrompt ? `\n\n${boundSessionPrompt}` : ''}${extraPrompt ? `\n\n${extraPrompt}` : ''}`.trim();

  return {
    systemPrompt,
    resolvedWorkingDirectory,
    chatSettings,
    enabledSkills,
    runtimeSkillNames,
    enabledMcpServers,
    runtimeDatabaseEnv,
    creationAssistantEnabled,
  };
}

export async function ensureEngineRuntimeSkillsAvailable(engineType: string, workDir: string, skillNames?: string[]): Promise<void> {
  try {
    const engineConfigDir = getWorkspaceAgentConfigDir(engineType);
    const configDir = resolve(workDir, engineConfigDir);
    const skillsDir = await getRuntimeSkillsDirPath();
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    if (!existsSync(skillsDir)) return;

    const selectedSkills = Array.from(new Set((skillNames || [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)));
    if (selectedSkills.length === 0) return;

    const workspaceSkillsDir = resolve(configDir, 'skills');
    if (isLinkedDirectoryTarget(workspaceSkillsDir, skillsDir)) {
      rmSync(workspaceSkillsDir, { recursive: true, force: true });
    }
    if (!existsSync(workspaceSkillsDir)) mkdirSync(workspaceSkillsDir, { recursive: true });

    for (const skillName of selectedSkills) {
      const src = resolve(skillsDir, skillName);
      const dst = resolve(workspaceSkillsDir, skillName);
      if (!existsSync(src) || existsSync(dst)) continue;
      createDirectoryLinkSync(src, dst);
    }
  } catch {
    // ignore sync failures; engine can still run without the link in some setups
  }
}
