import { describe, expect, test } from 'vitest';
import {
  buildFallbackOpeningLine,
  getOpeningToneExamples,
  normalizeOpeningContent,
} from '@/lib/agora/opening-copy';

describe('agora opening copy', () => {
  test('uses review-style natural fallback for code reviewer guests', () => {
    const participant = {
      id: 'guest-review',
      name: '代码评审',
      sourceType: 'preset' as const,
      presetId: 'code-reviewer',
      sourceAgent: 'code-hunter',
      createdAt: Date.now(),
    };

    expect(getOpeningToneExamples(participant)).toContain('我先看风险和回归点。');
    expect(buildFallbackOpeningLine(participant)).toBe('我先看风险和回归点。');
  });

  test('rewrites slogan-like opening lines to a more human fallback', () => {
    const fallback = buildFallbackOpeningLine({
      id: 'guest-review',
      name: '代码评审',
      sourceType: 'preset',
      presetId: 'code-reviewer',
      sourceAgent: 'code-hunter',
      createdAt: Date.now(),
    });

    expect(
      normalizeOpeningContent('代码先过我眼，风险无处遁形。', '代码评审', fallback)
    ).toBe('我先看风险和回归点。');
  });

  test('keeps natural colloquial openings unchanged', () => {
    expect(
      normalizeOpeningContent('我先看下这次改动。', '代码评审', '我先看风险和回归点。')
    ).toBe('我先看下这次改动。');
  });
});
