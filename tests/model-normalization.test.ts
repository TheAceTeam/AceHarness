import { describe, expect, test } from 'vitest';
import { normalizeModelOption } from '@/lib/core/models';

describe('model option normalization', () => {
  test('keeps an explicit empty endpoints array empty', () => {
    expect(normalizeModelOption({
      value: 'deepseek-chat',
      label: 'DeepSeek Chat',
      costMultiplier: 1,
      endpoints: [],
      engines: ['deepseek-harness'],
    }).endpoints).toEqual([]);
  });

  test('keeps compatibility defaults for an omitted endpoints field', () => {
    expect(normalizeModelOption({
      value: 'legacy-model',
      label: 'Legacy Model',
      costMultiplier: 1,
      endpoints: undefined as never,
    }).endpoints).toEqual(['anthropic', 'openai']);
  });
});
