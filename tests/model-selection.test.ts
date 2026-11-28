import { expect, test } from 'vitest';
import { groupModelEfforts, splitModelEffort, withModelEffort } from '@/lib/models/model-selection';

test('groups older selections and round trips generic effort configuration', () => {
  const common = { label: '5.5', endpoints: ['openai'], costMultiplier: 1 };
  const grouped = groupModelEfforts([
    { ...common, value: 'gpt-5.5', efforts: ['low', 'future'] },
    { ...common, value: 'gpt-5.5[effort=high]' },
  ]);
  expect(grouped).toHaveLength(1);
  expect(grouped[0].efforts).toEqual(['low', 'future', 'high']);
  expect(withModelEffort('gpt-5.5[fast-mode=on]', 'future')).toBe('gpt-5.5[fast-mode=on,effort=future]');
  expect(splitModelEffort('gpt-5.5[effort=high]').effort).toBe('high');
});
