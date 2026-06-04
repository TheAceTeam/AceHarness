import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { withTempDir } from './helpers/module-helpers';

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
  createDirectoryLinkSync: vi.fn(),
  isLinkedDirectoryTarget: vi.fn().mockReturnValue(false),
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
      { personalDir: undefined, workingDirectory: '/persisted/workdir' }
    );
    expect(result.enabledSkills).toEqual(['aceharness-chat-card']);
    expect(result.resolvedWorkingDirectory).toBe('/persisted/workdir');
    expect(result.systemPrompt).toContain('dashboard prompt');
    expect(result.systemPrompt).not.toContain('## 运行目录信息');
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
    expect(result.systemPrompt).toContain('API 查询结果');
    expect(result.systemPrompt).toContain('"kind":"card"');
  });

  test('links only selected runtime skills and keeps aceharness skills eligible', async () => {
    await withTempDir('aceharness-chat-skills-', async (base) => {
      const runtimeSkills = path.join(base, 'runtime-skills');
      const workDir = path.join(base, 'work');
      await mkdir(path.join(runtimeSkills, 'aceharness-chat-card'), { recursive: true });
      await mkdir(path.join(runtimeSkills, 'global-skill'), { recursive: true });
      await mkdir(path.join(runtimeSkills, 'unselected-skill'), { recursive: true });
      await mkdir(workDir, { recursive: true });

      const runtime = await import('@/lib/run/runtime-skills');
      const links = await import('@/lib/core/directory-links');
      vi.mocked(runtime.getRuntimeSkillsDirPath).mockResolvedValue(runtimeSkills);

      const { ensureEngineRuntimeSkillsAvailable } = await import('@/lib/chat/request-options');
      await ensureEngineRuntimeSkillsAvailable('codex', workDir, ['aceharness-chat-card', 'global-skill']);

      expect(links.createDirectoryLinkSync).toHaveBeenCalledWith(
        path.join(runtimeSkills, 'aceharness-chat-card'),
        path.join(workDir, '.engine', 'skills', 'aceharness-chat-card'),
      );
      expect(links.createDirectoryLinkSync).toHaveBeenCalledWith(
        path.join(runtimeSkills, 'global-skill'),
        path.join(workDir, '.engine', 'skills', 'global-skill'),
      );
      expect(vi.mocked(links.createDirectoryLinkSync).mock.calls.some((call) => String(call[1]).includes('unselected-skill'))).toBe(false);
    });
  });
});
