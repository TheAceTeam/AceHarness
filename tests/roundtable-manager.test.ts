import { describe, expect, test } from 'vitest';
import { extractRoundtableMentions } from '@/lib/roundtable-manager';

describe('roundtable mention order', () => {
  test('keeps explicit @agent order instead of participant list order', () => {
    const participants = ['agent-a', 'agent-b', 'agent-c'];

    expect(extractRoundtableMentions('@agent-c 先说，然后 @agent-a 补充', participants)).toEqual([
      'agent-c',
      'agent-a',
    ]);
  });

  test('expands @全员 at the point it appears and deduplicates later mentions', () => {
    const participants = ['agent-a', 'agent-b', 'agent-c'];

    expect(extractRoundtableMentions('@agent-c 先说，@全员 再补充，最后 @agent-a 不重复', participants)).toEqual([
      'agent-c',
      'agent-a',
      'agent-b',
    ]);
  });

  test('prefers longer overlapping agent names', () => {
    expect(extractRoundtableMentions('@agent-alpha 请先说，@agent 再回应', ['agent', 'agent-alpha'])).toEqual([
      'agent-alpha',
      'agent',
    ]);
  });
});
