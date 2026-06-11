import { describe, expect, test } from 'vitest';
import {
  AGENT_CONFIG_KIND,
  AGENT_EXECUTION_PROFILE_KIND,
  AGENT_ROLE_PROFILE_KIND,
  applyAgentCreationItem,
  buildAgentConfigFromCreationState,
  createEmptyAgentCreationState,
  extractAgentCreationItemResult,
} from '@/lib/ai/agent-creation-items';

describe('agent creation item protocol', () => {
  test('extracts one typed result item from result blocks', () => {
    const output = [
      '过程说明',
      '<result>{"kind":"agent_role_profile","data":{"displayName":"裁决助手","name":"judge-agent","team":"judge","roleType":"normal","mission":"裁定结果","style":"理性","specialties":["裁定"]}}</result>',
    ].join('\n');

    const extracted = extractAgentCreationItemResult(output, AGENT_ROLE_PROFILE_KIND);

    expect(extracted.ok).toBe(true);
    if (extracted.ok) {
      expect(extracted.result.data.team).toBe('judge');
      expect(extracted.result.data.name).toBe('judge-agent');
    }
  });

  test('assembles a valid agent config from structured items', () => {
    let state = createEmptyAgentCreationState();
    state = applyAgentCreationItem(state, {
      kind: AGENT_ROLE_PROFILE_KIND,
      data: {
        displayName: '裁决助手',
        name: 'judge-agent',
        team: 'judge',
        roleType: 'normal',
        mission: '裁定流程结论',
        style: '理性',
        specialties: ['裁定', '审查'],
      },
    });
    state = applyAgentCreationItem(state, {
      kind: AGENT_EXECUTION_PROFILE_KIND,
      data: {
        capabilities: ['裁定', '归档'],
        constraints: ['保持结论明确'],
        keywords: ['judge'],
        systemPrompt: '你负责裁定流程结论。',
        description: '裁定流程结论并归档。',
        tags: ['裁定'],
        category: 'AI创建',
      },
    });
    state = applyAgentCreationItem(state, {
      kind: AGENT_CONFIG_KIND,
      data: {
        agent: {
          name: 'judge-agent',
          team: 'judge',
          roleType: 'normal',
          avatar: { mode: 'deterministic', seed: 'judge-agent', style: 'pixel-art' },
          engineModels: {},
          activeEngine: '',
          capabilities: ['裁定'],
          systemPrompt: '你负责裁定流程结论。',
          description: '裁定流程结论并归档。',
        },
      },
    });

    const config = buildAgentConfigFromCreationState({
      state,
      displayName: '裁决助手',
      team: 'judge',
      mission: '裁定流程结论',
      style: '理性',
      specialties: '裁定',
    });

    expect(config).toMatchObject({
      name: 'judge-agent',
      team: 'judge',
      roleType: 'normal',
      avatar: { style: 'pixel-art' },
      activeEngine: '',
    });
    expect(config.capabilities).toContain('裁定');
    expect(config.systemPrompt).toBe('你负责裁定流程结论。');
  });
});
