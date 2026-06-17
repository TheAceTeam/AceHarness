import { loadSystemSettings, normalizeAgentMemorySettings, type SystemSettings } from '@/lib/config/system-settings';
import {
  buildMemoryPromptBlock,
  listMemoryEntries,
  type MemoryEntry,
} from '@/lib/workflow/memory-store';
import {
  buildWorkflowExperiencePromptBlock,
  findRelevantWorkflowExperiences,
} from '@/lib/workflow/experience-store';

export type AgentMemoryResolverMode = 'standalone-chat' | 'workflow-chat';

export interface AgentMemorySnapshot {
  runtimeEnabled: boolean;
  entries: MemoryEntry[];
  mergedContent: string;
  charCount: number;
  maxChars: number;
  overLimit: boolean;
  promptBlock: string;
}

function clampMemoryBudget(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.max(0, Math.min(50000, Math.floor(parsed)));
}

function truncateByBudget(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n...（已截断）`;
}

export async function resolveAgentRoleMemory(input: {
  agentName: string;
  maxChars?: number;
  runtimeEnabled?: boolean;
}): Promise<AgentMemorySnapshot> {
  const systemSettings = await loadSystemSettings().catch((): SystemSettings => ({}));
  const settings = normalizeAgentMemorySettings(systemSettings.agentMemory);
  const runtimeEnabled = input.runtimeEnabled ?? settings.runtimeEnabled;
  const maxChars = clampMemoryBudget(input.maxChars);
  const entries = runtimeEnabled
    ? await listMemoryEntries({ scope: 'role', key: input.agentName, limit: 60 }).catch(() => [])
    : [];
  const mergedContent = truncateByBudget(
    entries.map((entry) => entry.content.trim()).filter(Boolean).join('\n\n'),
    maxChars,
  );
  const promptBlock = mergedContent
    ? [
      '<agent-memory>',
      '以下是该 Agent 的基础长期记忆，仅用于保持长期偏好、经验和已知背景。',
      mergedContent,
      '</agent-memory>',
    ].join('\n')
    : '';

  return {
    runtimeEnabled,
    entries,
    mergedContent,
    charCount: mergedContent.length,
    maxChars,
    overLimit: entries.map((entry) => entry.content.trim()).filter(Boolean).join('\n\n').length > maxChars,
    promptBlock,
  };
}

export async function resolveAgentMemoryContext(input: {
  agentName: string;
  mode: AgentMemoryResolverMode;
  workflowContext?: Record<string, any> | null;
  workingDirectory?: string;
  sessionId?: string;
  maxRoleMemoryChars?: number;
}): Promise<string> {
  const systemSettings = await loadSystemSettings().catch((): SystemSettings => ({}));
  const settings = normalizeAgentMemorySettings(systemSettings.agentMemory);
  if (!settings.runtimeEnabled) return '';

  const sections: string[] = [];
  const roleMemory = await resolveAgentRoleMemory({
    agentName: input.agentName,
    maxChars: input.maxRoleMemoryChars,
    runtimeEnabled: true,
  });
  if (roleMemory.promptBlock) sections.push(roleMemory.promptBlock);

  if (input.mode === 'workflow-chat' && input.workflowContext?.configFile) {
    const workflowMemories = await listMemoryEntries({
      scope: 'workflow',
      key: String(input.workflowContext.configFile),
      limit: 3,
    }).catch(() => []);
    const workflowBlock = buildMemoryPromptBlock('当前工作流记忆', workflowMemories, { maxItems: 3 });
    if (workflowBlock) sections.push(workflowBlock);

    const relatedExperiences = await findRelevantWorkflowExperiences({
      configFile: String(input.workflowContext.configFile || ''),
      workflowName: String(input.workflowContext.workflowName || ''),
      requirements: String(input.workflowContext.requirements || ''),
      projectRoot: input.workingDirectory,
      agentName: input.agentName,
      excludeRunId: typeof input.workflowContext.runId === 'string' ? input.workflowContext.runId : undefined,
      limit: 2,
    }).catch(() => []);
    const experienceBlock = buildWorkflowExperiencePromptBlock(relatedExperiences, '相关历史经验');
    if (experienceBlock) sections.push(experienceBlock);
  }

  if (input.workingDirectory) {
    const projectMemories = await listMemoryEntries({
      scope: 'project',
      key: input.workingDirectory,
      limit: 3,
    }).catch(() => []);
    const projectBlock = buildMemoryPromptBlock('项目级共享记忆', projectMemories, { maxItems: 3 });
    if (projectBlock) sections.push(projectBlock);
  }

  if (input.sessionId) {
    const chatMemories = await listMemoryEntries({
      scope: 'chat',
      key: `${input.agentName}:${input.sessionId}`,
      limit: 4,
    }).catch(() => []);
    const chatBlock = buildMemoryPromptBlock('当前会话补充记忆', chatMemories, { maxItems: 4 });
    if (chatBlock) sections.push(chatBlock);
  }

  if (sections.length === 0) return '';

  return [
    '## 多层记忆注入规则',
    '- 角色长期记忆：可跨 run 沉淀这个 Agent 的稳定协作偏好与复盘结果。',
    '- 项目级共享记忆：仅代表当前工程的长期经验，不可误用到其他工程。',
    '- 工作流记忆：只适用于当前 workflow/run 的设计与执行上下文。',
    '- 会话补充记忆：只适用于当前 chat session，不要把它提升为长期事实，除非用户再次确认。',
    ...sections,
  ].join('\n\n');
}
