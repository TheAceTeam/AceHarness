import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/core/app-paths', () => ({
  getRepoRoot: vi.fn(() => '/repo'),
  getWorkspaceRoot: vi.fn(() => '/runtime'),
}));

vi.mock('@/lib/run/runtime-skills', () => ({
  getRuntimeSkillPath: vi.fn((skill: string) => `/runtime/skills/${skill}/SKILL.md`),
  getRuntimeSkillsDirPath: vi.fn(async () => '/runtime/skills'),
}));

describe('dashboard system prompt', () => {
  test('keeps a large enabled skill catalogue discoverable without inlining every reference', async () => {
    const { buildDashboardSystemPrompt } = await import('@/lib/chat/system-prompt');
    const skills = Array.from({ length: 13 }, (_value, index) => `skill-${index + 1}`);

    const prompt = await buildDashboardSystemPrompt(skills, {
      personalDir: '/personal',
      workingDirectory: '/work',
    });

    expect(prompt).toContain('当前已启用 13 个 Skills');
    expect(prompt).toContain('普通问候或无需 Skill 的问题不要加载 Skill');
    expect(prompt).toContain('`/runtime/skills`');
    expect(prompt).not.toContain('- skill-1:');
  });

  test('keeps explicit references for a small enabled skill set', async () => {
    const { buildDashboardSystemPrompt } = await import('@/lib/chat/system-prompt');

    const prompt = await buildDashboardSystemPrompt(['skill-a', 'skill-b']);

    expect(prompt).toContain('- skill-a:');
    expect(prompt).toContain('- skill-b:');
  });
});
