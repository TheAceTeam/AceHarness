import { describe, expect, test } from 'vitest';
import { parseProviderQualifiedModelId, qualifyModelId } from '@/lib/models/provider-qualified-id';

describe('provider-qualified model ids', () => {
  test('splits provider and model while preserving the catalog id separately', () => {
    expect(parseProviderQualifiedModelId('boft-deepseek/deepseek-v4-flash')).toEqual({
      providerId: 'boft-deepseek',
      modelId: 'deepseek-v4-flash',
    });
  });

  test('leaves bare and malformed ids unchanged', () => {
    expect(parseProviderQualifiedModelId('deepseek-v4-pro')).toEqual({ modelId: 'deepseek-v4-pro' });
    expect(parseProviderQualifiedModelId('/deepseek-v4-pro')).toEqual({ modelId: '/deepseek-v4-pro' });
    expect(parseProviderQualifiedModelId('boft-deepseek/')).toEqual({ modelId: 'boft-deepseek/' });
  });

  test('qualifies only when both parts are present', () => {
    expect(qualifyModelId('boft', 'gpt-5.6-sol')).toBe('boft/gpt-5.6-sol');
    expect(qualifyModelId('', 'gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(qualifyModelId('boft', '')).toBe('');
  });
});
