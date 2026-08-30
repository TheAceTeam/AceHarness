import { describe, expect, test } from 'vitest';
import { mergeDetectedModelsForImport } from '@/lib/models/import-merge';

describe('model import merge', () => {
  test('adds detected model when it does not exist', () => {
    const merged = mergeDetectedModelsForImport({
      models: [],
      detectedModels: [
        {
          modelId: 'gpt-5.5',
          label: 'GPT 5.5',
          costMultiplier: 1,
          selected: true,
        },
      ],
      engine: 'codex',
    });

    expect(merged).toEqual([
      {
        value: 'gpt-5.5',
        label: 'GPT 5.5',
        costMultiplier: 1,
        endpoints: [],
        engines: ['codex'],
      },
    ]);
  });

  test('merges same model id without creating duplicate rows', () => {
    const merged = mergeDetectedModelsForImport({
      models: [
        {
          value: 'shared-model',
          label: 'Shared Model',
          costMultiplier: 2,
          endpoints: ['openai'],
          engines: ['opencode'],
        },
      ],
      detectedModels: [
        {
          modelId: 'shared-model',
          label: 'Shared Model Updated',
          costMultiplier: 1,
          endpoints: ['anthropic', 'openai'],
          selected: true,
        },
      ],
      engine: 'codex',
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      value: 'shared-model',
      label: 'Shared Model Updated',
      costMultiplier: 1,
      endpoints: ['openai', 'anthropic'],
      engines: ['opencode', 'codex'],
    });
  });

  test('skips unselected detected models', () => {
    const merged = mergeDetectedModelsForImport({
      models: [],
      detectedModels: [
        {
          modelId: 'skip-me',
          label: 'Skip Me',
          selected: false,
        },
      ],
      engine: 'codex',
    });

    expect(merged).toEqual([]);
  });

  test('preserves the detected endpoint without inferring a provider endpoint', () => {
    const merged = mergeDetectedModelsForImport({
      models: [],
      detectedModels: [{ modelId: 'deepseek-chat', label: 'DeepSeek Chat', selected: true }],
      engine: 'deepseek-harness',
    });

    expect(merged).toEqual([{
      value: 'deepseek-chat',
      label: 'DeepSeek Chat',
      costMultiplier: 1,
      endpoints: [],
      engines: ['deepseek-harness'],
    }]);
  });

  test('keeps a provider-qualified id and its API endpoint distinct', () => {
    const merged = mergeDetectedModelsForImport({
      models: [],
      detectedModels: [{
        modelId: 'boft/gpt-5.6-sol',
        label: 'GPT 5.6 Sol',
        endpoints: ['deepseek'],
        selected: true,
      }],
      engine: 'deepseek-harness',
    });

    expect(merged[0]).toMatchObject({
      value: 'boft/gpt-5.6-sol',
      endpoints: ['deepseek'],
      engines: ['deepseek-harness'],
    });
  });
});
