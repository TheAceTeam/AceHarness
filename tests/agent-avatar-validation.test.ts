import { describe, expect, test } from 'vitest';
import { normalizeAgentDraftPreview } from '@/lib/agent/draft';
import { normalizeAgentAvatar } from '@/lib/agent/personas';
import { validateAgentDraft } from '@/lib/core/creator-validation';

describe('agent avatar normalization', () => {
  test('normalizes legacy avatar style aliases', () => {
    const avatar = normalizeAgentAvatar(
      {
        mode: 'deterministic',
        seed: 'judge-agent',
        style: 'pixel-at' as any,
      },
      'judge-agent',
      { team: 'judge', roleType: 'normal' },
    );

    expect(avatar).toMatchObject({
      mode: 'deterministic',
      seed: 'judge-agent',
      style: 'pixel-art',
    });
  });

  test('normalizes avatar objects before agent draft validation', () => {
    const result = validateAgentDraft({
      name: 'judge-agent',
      team: 'judge',
      roleType: 'normal',
      avatar: {
        mode: 'deterministic',
        seed: 'judge-agent',
        style: 'pixel-at',
      },
      engineModels: { openai: 'gpt-5' },
      activeEngine: 'openai',
      capabilities: ['裁决'],
      systemPrompt: '你负责裁定结果。',
      description: '裁决 Agent',
      keywords: ['裁决'],
      tags: ['AI创建'],
    });

    expect(result.ok).toBe(true);
    expect(result.normalized?.avatar).toMatchObject({
      style: 'pixel-art',
    });
  });

  test('normalizes AI draft preview avatars before rendering or saving', () => {
    const preview = normalizeAgentDraftPreview(
      {
        name: 'judge-agent',
        team: 'judge',
        roleType: 'normal',
        avatar: {
          mode: 'deterministic',
          style: 'pixel-at',
        },
        engineModels: { openai: 'gpt-5' },
        activeEngine: 'openai',
        capabilities: ['裁决'],
        systemPrompt: '你负责裁定结果。',
        description: '裁决 Agent',
      },
      {
        engine: 'openai',
        model: 'gpt-5',
        draft: {
          displayName: '裁决助手',
          team: 'judge',
          mission: '裁定流程结论',
          style: '理性',
          specialties: '裁定',
          canCode: 'no',
          canSupervise: 'no',
          workingDirectory: '',
          referenceWorkflow: '',
        },
      },
    );

    expect(preview?.avatar).toMatchObject({
      style: 'pixel-art',
      seed: 'judge-agent',
    });
  });
});
