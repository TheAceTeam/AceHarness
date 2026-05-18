import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/chat/settings', () => ({
  loadChatSettings: vi.fn().mockResolvedValue({
    skills: {
      'global-skill': true,
      'aceharness-chat-card': false,
      'aceharness-workflow-creator': false,
    },
    workingDirectory: '/persisted/workdir',
  }),
}));

vi.mock('@/lib/chat/system-prompt', () => ({
  buildDashboardSystemPrompt: vi.fn().mockResolvedValue('dashboard prompt'),
}));

vi.mock('@/lib/core/app-paths', () => ({
  getRepoRoot: vi.fn().mockReturnValue('/repo'),
  getWorkspaceDataFile: vi.fn().mockReturnValue('/workspace-data'),
  getWorkspaceRoot: vi.fn().mockReturnValue('/workspace'),
  getInstallPath: vi.fn().mockReturnValue('/install'),
  getWorkspaceCacheFile: vi.fn().mockReturnValue('/workspace-cache'),
  getWorkspaceSkillPath: vi.fn().mockReturnValue('/workspace/skills/demo'),
  getWorkspaceSkillsDir: vi.fn().mockReturnValue('/workspace/skills'),
}));

vi.mock('@/lib/chat/persistence', () => ({
  loadChatSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/spec/coding-store', () => ({
  loadCreationSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/workflow/registry', () => ({
  workflowRegistry: {
    getManager: vi.fn(),
  },
}));

vi.mock('@/lib/run/runtime-skills', () => ({
  getRuntimeSkillsDirPath: vi.fn().mockResolvedValue('/workspace/skills'),
}));

vi.mock('@/lib/core/directory-links', () => ({
  ensureDirectoryLinkSync: vi.fn(),
}));

vi.mock('@/lib/engines/engine-config', () => ({
  getEngineConfigDir: vi.fn().mockReturnValue('.engine'),
}));

describe('chat-request-options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('request-level skills override persisted chat settings for dashboard chat', async () => {
    const { buildChatRequestContext } = await import('@/lib/chat/request-options');
    const { buildDashboardSystemPrompt } = await import('@/lib/chat/system-prompt');

    const result = await buildChatRequestContext({
      mode: 'dashboard',
      requestedSkills: ['aceharness-chat-card'],
    });

    expect(buildDashboardSystemPrompt).toHaveBeenCalledWith(
      ['aceharness-chat-card', 'aceharness-workflow-creator'],
      { personalDir: undefined }
    );
    expect(result.enabledSkills).toEqual(['aceharness-chat-card']);
    expect(result.resolvedWorkingDirectory).toBe('/persisted/workdir');
    expect(result.systemPrompt).toContain('dashboard prompt');
    expect(result.systemPrompt).toContain('当前工作目录(用户语义目录): /persisted/workdir');
  });

  test('resume dashboard chat uses lightweight requested skills reminder instead of rebuilding full prompt', async () => {
    const { buildChatRequestContext } = await import('@/lib/chat/request-options');
    const { buildDashboardSystemPrompt } = await import('@/lib/chat/system-prompt');

    const result = await buildChatRequestContext({
      mode: 'dashboard',
      sessionId: 'session-1',
      requestedSkills: {
        'aceharness-chat-card': true,
      },
    });

    expect(buildDashboardSystemPrompt).not.toHaveBeenCalled();
    expect(result.enabledSkills).toEqual(['aceharness-chat-card']);
    expect(result.systemPrompt).toContain('当前启用的 Skills: aceharness-chat-card');
  });
});
