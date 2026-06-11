import { describe, expect, test } from 'vitest';
import { buildAgentDraftPrompt } from '@/lib/agent/ai-draft-prompt';

describe('buildAgentDraftPrompt', () => {
  test('uses positive item schema guidance with canonical avatar enums', () => {
    const prompt = buildAgentDraftPrompt({
      displayName: '裁决助手',
      team: 'judge',
      mission: '裁定结果',
      style: '理性',
      specialties: '裁定,审查',
    });

    expect(prompt).toContain('"kind":"agent_clarification_summary"');
    expect(prompt).toContain('"kind":"agent_role_profile"');
    expect(prompt).toContain('"kind":"agent_execution_profile"');
    expect(prompt).toContain('"kind":"agent_config"');
    expect(prompt).toContain('avatar.mode 取值为 deterministic、generated、uploaded、preset、sprite');
    expect(prompt).toContain('avatar.style 取值为 personas、adventurer、pixel-art');
    expect(prompt).toContain('judge 对应 pixel-art');
    expect(prompt).not.toContain('严禁');
    expect(prompt).not.toContain('pixel-at');
  });
});
