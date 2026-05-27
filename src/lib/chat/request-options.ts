import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { loadChatSettings, type ChatSettings } from '@/lib/chat/settings';
import { buildDashboardSystemPrompt } from '@/lib/chat/system-prompt';
import { getRepoRoot, getWorkspaceDataFile, getWorkspaceRoot } from '@/lib/core/app-paths';
import { loadChatSession } from '@/lib/chat/persistence';
import { loadCreationSession } from '@/lib/spec/coding-store';
import { workflowRegistry } from '@/lib/workflow/registry';
import { getEngineConfigDir } from '@/lib/engines/engine-config';
import { resolveMcpServersByNames, type ManagedMcpServer } from '@/lib/mcp/registry';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { ensureDirectoryLinkSync } from '@/lib/core/directory-links';

const DEFAULT_PROMPT = '你是一个 AI 助手，简洁回答问题。';
const SESSIONS_DIR = getWorkspaceDataFile('chat-sessions');
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

function buildRuntimeEnvPrompt(resolvedWorkingDirectory: string): string {
  const engineRuntimeDirectory = getWorkspaceRoot();
  return [
    '## 运行目录信息',
    `ACEFlow 安装目录: ${getRepoRoot()}`,
    `系统数据保存目录: ${engineRuntimeDirectory}`,
    '系统数据保存目录中包含 ACEHarness 的全局安装技能、工作流与对话的历史记录、Agent 配置等运行时数据。',
    `当前工作目录(用户语义目录): ${resolvedWorkingDirectory}`,
    `AI 运行目录(实际 cwd): ${engineRuntimeDirectory}`,
    '执行文件读写/命令时，请优先基于“当前工作目录(用户语义目录)”使用绝对路径。',
  ].join('\n');
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
    const filePath = resolve(SESSIONS_DIR, `${frontendSessionId}.json`);
    const content = await readFile(filePath, 'utf-8');
    const session = JSON.parse(content);
    const messages: { role: string; content: string }[] = session.messages || [];
    if (messages.length === 0) return '';

    let history = '';
    for (const msg of messages) {
      if (!msg.content) continue;
      const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : '系统';
      let text = msg.content
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
  personalDir?: string;
}): Promise<{
  systemPrompt: string;
  resolvedWorkingDirectory: string;
  chatSettings: ChatSettings | null;
  enabledSkills: string[];
  enabledMcpServers: ManagedMcpServer[];
}> {
  const {
    mode,
    sessionId,
    frontendSessionId,
    workingDirectory,
    extraSystemPrompt,
    requestedSkills,
    requestedMcpServers,
    personalDir,
  } = options;

  const isResume = Boolean(sessionId);
  const chatSettings = mode === 'dashboard' ? await loadChatSettings() : null;
  const enabledSkills = chatSettings ? resolveEnabledSkills(chatSettings, requestedSkills) : [];
  const requestedWorkingDirectory = typeof workingDirectory === 'string' ? workingDirectory.trim() : '';
  const engineRuntimeDirectory = getWorkspaceRoot();
  const resolvedWorkingDirectory = requestedWorkingDirectory || chatSettings?.workingDirectory || engineRuntimeDirectory;
  const enabledMcpServers = chatSettings
    ? await resolveEnabledMcpServers(chatSettings, requestedMcpServers, resolvedWorkingDirectory)
    : [];

  let systemPrompt = '';
  if (mode === 'dashboard') {
    if (isResume) {
      systemPrompt = enabledSkills.length > 0
        ? `当前启用的 Skills: ${enabledSkills.join(', ')}。需要时查阅 skills/{skill-name}/SKILL.md。`
        : '';
    } else {
      const mergedSkills = [...enabledSkills];
      for (const skillName of REQUIRED_DASHBOARD_SKILLS) {
        if (!mergedSkills.includes(skillName)) mergedSkills.push(skillName);
      }
      systemPrompt = await buildDashboardSystemPrompt(mergedSkills, { personalDir });
    }
  } else if (!isResume) {
    systemPrompt = DEFAULT_PROMPT;
  }

  const runtimeEnvPrompt = buildRuntimeEnvPrompt(resolvedWorkingDirectory);
  const boundSessionPrompt = await buildBoundSessionContext(frontendSessionId);
  const extraPrompt = typeof extraSystemPrompt === 'string' ? extraSystemPrompt.trim() : '';

  systemPrompt = `${systemPrompt}\n\n${runtimeEnvPrompt}${boundSessionPrompt ? `\n\n${boundSessionPrompt}` : ''}${extraPrompt ? `\n\n${extraPrompt}` : ''}`.trim();

  return {
    systemPrompt,
    resolvedWorkingDirectory,
    chatSettings,
    enabledSkills,
    enabledMcpServers,
  };
}

export async function ensureEngineRuntimeSkillsAvailable(engineType: string, workDir: string): Promise<void> {
  try {
    const engineConfigDir = getEngineConfigDir(engineType);
    const configDir = resolve(workDir, engineConfigDir);
    const skillsDir = await getRuntimeSkillsDirPath();
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const skillsLink = resolve(configDir, 'skills');
    if (existsSync(skillsDir)) ensureDirectoryLinkSync(skillsDir, skillsLink);
  } catch {
    // ignore sync failures; engine can still run without the link in some setups
  }
}
