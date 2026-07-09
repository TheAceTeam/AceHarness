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
});
