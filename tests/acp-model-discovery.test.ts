import { describe, expect, test } from 'vitest';
import { ACPEngine, normalizeAcpModelsFromSessionResult } from '@/lib/engines/acp-engine';

function resolveModelIdForTest(
  input: string,
  models: Array<{ modelId: string; name: string }>,
): string {
  const engine = new ACPEngine({
    engineType: 'opencode',
    command: 'opencode',
    workingDirectory: process.cwd(),
  });
  (engine as any).availableModels = models;
  return (engine as any).resolveModelId(input);
}

describe('ACP model discovery normalization', () => {
  test('reads legacy models.availableModels', () => {
    const models = normalizeAcpModelsFromSessionResult({
      models: {
        availableModels: [
          { modelId: 'provider/claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
          { modelId: 'provider/gpt-5.3-codex' },
        ],
      },
    });

    expect(models).toEqual([
      { modelId: 'provider/claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
      { modelId: 'provider/gpt-5.3-codex', name: 'provider/gpt-5.3-codex' },
    ]);
  });

  test('reads OpenCode 1.15 model config option', () => {
    const models = normalizeAcpModelsFromSessionResult({
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          options: [
            {
              value: 'siliconflow-cn/ascend-tribe/pangu-pro-moe',
              name: 'SiliconFlow (China)/ascend-tribe/pangu-pro-moe',
            },
            {
              value: 'penguiapigpt/gpt-5.3-codex',
              name: 'penguiapigpt/gpt-5.3-codex',
            },
          ],
        },
        {
          id: 'mode',
          name: 'Session Mode',
          type: 'select',
          options: [{ value: 'build', name: 'build' }],
        },
      ],
    });

    expect(models).toEqual([
      {
        modelId: 'siliconflow-cn/ascend-tribe/pangu-pro-moe',
        name: 'SiliconFlow (China)/ascend-tribe/pangu-pro-moe',
      },
      {
        modelId: 'penguiapigpt/gpt-5.3-codex',
        name: 'penguiapigpt/gpt-5.3-codex',
      },
    ]);
  });

  test('deduplicates models across legacy and config option sources', () => {
    const models = normalizeAcpModelsFromSessionResult({
      models: {
        availableModels: [{ modelId: 'opencode/big-pickle', name: 'Big Pickle' }],
      },
      configOptions: [
        {
          id: 'model',
          options: [
            { value: 'opencode/big-pickle', name: 'Big Pickle duplicate' },
            { value: 'opencode/deepseek-v4-flash-free' },
          ],
        },
      ],
    });

    expect(models).toEqual([
      { modelId: 'opencode/big-pickle', name: 'Big Pickle' },
      { modelId: 'opencode/deepseek-v4-flash-free', name: 'opencode/deepseek-v4-flash-free' },
    ]);
  });

  test('resolves an exact display name before fuzzy shorter similar model IDs', () => {
    const resolved = resolveModelIdForTest('gpt-5.3-codex', [
      {
        modelId: 'x/gpt-5.3-codex-preview',
        name: 'gpt-5.3-codex preview',
      },
      {
        modelId: 'provider-catalog/internal-gpt-5.3-codex',
        name: 'gpt-5.3-codex',
      },
    ]);

    expect(resolved).toBe('provider-catalog/internal-gpt-5.3-codex');
  });

  test('resolves an exact provider-qualified display name directly', () => {
    const resolved = resolveModelIdForTest('penguiapigpt/gpt-5.3-codex', [
      {
        modelId: 'penguiapigpt/gpt-5.3-codex-preview',
        name: 'penguiapigpt/gpt-5.3-codex preview',
      },
      {
        modelId: 'provider-catalog/internal-gpt-5.3-codex',
        name: 'penguiapigpt/gpt-5.3-codex',
      },
    ]);

    expect(resolved).toBe('provider-catalog/internal-gpt-5.3-codex');
  });
});
