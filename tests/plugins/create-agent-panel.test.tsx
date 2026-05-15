// @vitest-environment jsdom
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentPanel } from '@/plugins/create-agent/AgentPanel';
import { createInitialAgentDraft } from '@/lib/agent/draft';

vi.mock('@/components/ui/combobox', () => ({
  SingleCombobox: ({ value }: { value?: string }) => (
    <input data-testid="mock-combobox" readOnly value={value || ''} />
  ),
}));

describe('AgentPanel', () => {
  test('renders preview fields safely when an avatar config object reaches a text slot', () => {
    expect(() => {
      render(
        <AgentPanel
          sidebarHint={null}
          agentDraft={createInitialAgentDraft({
            displayName: '修复助手',
            mission: '定位并修复问题',
          })}
          setAgentDraft={vi.fn()}
          agentDraftPreview={{
            name: { mode: 'deterministic', seed: '修复助手', style: 'adventurer' },
            team: 'red',
            activeEngine: 'codex',
            description: { mode: 'deterministic', seed: '描述文本', style: 'personas' },
            capabilities: [
              '修复',
              { mode: 'deterministic', seed: '代码审查', style: 'pixel-art' },
            ],
            systemPrompt: { mode: 'deterministic', seed: '系统提示词', style: 'personas' },
          }}
          agentDraftRaw=""
          draftingAgent={false}
          creatingAgent={false}
          engine="codex"
          workflows={[]}
          onOpenModal={vi.fn()}
          onOpenAgentsPage={vi.fn()}
          onGenerateDraft={vi.fn()}
          onCreateAgent={vi.fn()}
        />
      );
    }).not.toThrow();

    expect(screen.getAllByText('修复助手').length).toBeGreaterThan(0);
    expect(screen.getByText('描述文本')).toBeInTheDocument();
    expect(screen.getByText('代码审查')).toBeInTheDocument();
    expect(screen.getByText('系统提示词')).toBeInTheDocument();
  });
});
