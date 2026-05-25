import { describe, expect, test } from 'vitest';
import {
  AVATAR_CATEGORIES,
  DEFAULT_AGENT_AVATAR_CATEGORY,
  pickSpriteAvatar,
} from '@/lib/avatar/sprite';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';

const isGroup1PersonAvatar = (index: number) => index >= 50 && index <= 99;

describe('avatar sprite defaults', () => {
  test('limits the AI default hash pool to person avatars', () => {
    const agentDefault = AVATAR_CATEGORIES.find((category) => category.id === DEFAULT_AGENT_AVATAR_CATEGORY);

    expect(agentDefault?.entries.length).toBeGreaterThan(0);
    expect(agentDefault?.entries.every((entry) => (
      entry.sheetId === 'group1' && isGroup1PersonAvatar(entry.index)
    ))).toBe(true);
  });

  test('hashes AI avatar seeds only into person avatars', () => {
    const seeds = [
      '架构师',
      '测试工程师',
      'agora-guest-reviewer',
      'workflow-agent-alpha',
      '临时嘉宾',
      'codex-helper',
    ];

    for (const seed of seeds) {
      const entry = pickSpriteAvatar(seed, { category: DEFAULT_AGENT_AVATAR_CATEGORY });
      expect(entry.sheetId).toBe('group1');
      expect(isGroup1PersonAvatar(entry.index)).toBe(true);

      const src = resolveAgentAvatarSrc(undefined, seed);
      const match = /^sprite:group1:(\d+)$/.exec(src);
      expect(match).not.toBeNull();
      expect(isGroup1PersonAvatar(Number(match?.[1]))).toBe(true);
    }
  });
});
