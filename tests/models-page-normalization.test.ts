import { describe, expect, test } from 'vitest';
import { normalizeClientModelOptions } from '@/client/pages/ModelsPage';

describe('ModelsPage client model normalization', () => {
  test('uses the catalog model id instead of a route id as the row identity', () => {
    const [model] = normalizeClientModelOptions([{
      value: 'boft-deepseek/deepseek-v4-flash',
      modelId: 'boft-deepseek/deepseek-v4-flash',
      modelRouteId: 'deepseek-harness__boft-deepseek-deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      endpoints: ['deepseek'],
      engines: ['deepseek-harness'],
    }]);

    expect(model).toMatchObject({
      id: 'boft-deepseek/deepseek-v4-flash',
      modelId: 'boft-deepseek/deepseek-v4-flash',
      modelRouteId: 'deepseek-harness__boft-deepseek-deepseek-v4-flash',
    });
  });

  test('falls back to value for catalog-only models without modelId', () => {
    const [model] = normalizeClientModelOptions([{
      value: 'deepseek-chat',
      label: 'DeepSeek Chat',
      endpoints: [],
      engines: ['deepseek-harness'],
    }]);

    expect(model).toMatchObject({
      id: 'deepseek-chat',
      modelId: 'deepseek-chat',
    });
  });
});
