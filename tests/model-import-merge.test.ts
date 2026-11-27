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
        endpoints: ['openai'],
        engines: ['codex'],
      },
    ]);
  });

  test('preserves advertised bracket options and uses an OpenAI route', () => {
    const models = mergeDetectedModelsForImport({ models: [], engine: 'codex', detectedModels: [
      { modelId: 'gpt-6.2-sol[future-effort]', label: '6.2 Sol [future-effort]' },
    ] });
    expect(models[0]).toMatchObject({
      value: 'gpt-6.2-sol[future-effort]', label: '6.2 Sol [future-effort]', endpoints: ['openai'],
    });
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
