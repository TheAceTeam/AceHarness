// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockListAllConfigs, mockDraftAgent, mockClarifyAgent, mockToast } = vi.hoisted(() => ({
  mockListAllConfigs: vi.fn(async () => ({ configs: [] })),
  mockDraftAgent: vi.fn(),
  mockClarifyAgent: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@/lib/core/api', () => ({
  agentApi: {
    draftAgent: mockDraftAgent,
    draftAgentStream: mockDraftAgent,
    clarifyAgentStream: mockClarifyAgent,
    generateAvatar: vi.fn(),
  },
  configApi: {
    listAllConfigs: () => mockListAllConfigs(),
  },
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/components/agent/AgentHeroCard', () => ({
  AgentHeroCard: ({ agent }: any) => (
    <div data-testid="agent-hero-card" data-avatar-seed={agent?.avatar?.seed || ''}>
      {agent?.name || 'agent'}
    </div>
  ),
}));

vi.mock('@/components/chat/ChatMessage', () => ({
  WrapperProcessBlocks: ({ content }: any) => (
    <div data-testid="wrapper-process-blocks">
      {String(content || '').includes('<ace-process>') ? 'rendered process blocks' : String(content || '')}
    </div>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? <div data-testid="dialog-root">{children}</div> : null),
  DialogContent: ({ children, className }: any) => <div data-testid="dialog-content" className={className}>{children}</div>,
  DialogDescription: ({ children, className }: any) => <div className={className}>{children}</div>,
  DialogFooter: ({ children, className }: any) => <div className={className}>{children}</div>,
  DialogHeader: ({ children, className }: any) => <div className={className}>{children}</div>,
  DialogTitle: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock('@/components/ui/combobox', () => ({
  ComboboxPortalProvider: ({ children }: any) => (
    <div data-testid="combobox-portal-provider">{children}</div>
  ),
  SingleCombobox: ({ value, onValueChange, options = [] }: any) => (
    <select data-testid="single-combobox" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@/components/EngineSelect', () => ({
  EngineSelect: ({ value, onChange }: any) => (
    <select aria-label="engine-select" value={value} onChange={(event) => onChange?.(event.target.value)}>
      <option value="">跟随全局</option>
      <option value="openai">OpenAI</option>
      <option value="codex">Codex</option>
    </select>
  ),
}));

vi.mock('@/components/ModelSelect', () => ({
  ModelSelect: ({ value, onChange }: any) => (
    <select aria-label="model-select" value={value} onChange={(event) => onChange?.(event.target.value)}>
      <option value="">选择模型</option>
      <option value="gpt-5">GPT-5</option>
      <option value="gpt-5-mini">GPT-5 mini</option>
    </select>
  ),
}));

vi.mock('@/lib/agent/draft', () => ({
  createInitialAgentDraft: (initial?: any) => ({
    displayName: '',
    team: 'red',
    mission: '',
    style: '',
    specialties: '',
    workingDirectory: '',
    referenceWorkflow: '',
    canCode: 'yes',
    canSupervise: 'no',
    ...initial,
  }),
  normalizeAgentDraft: (initial?: any) => ({
    displayName: '',
    team: 'red',
    mission: '',
    style: '',
    specialties: '',
    workingDirectory: '',
    referenceWorkflow: '',
    canCode: 'yes',
    canSupervise: 'no',
    ...initial,
  }),
  extractAgentDraftCapabilities: () => [],
  buildAgentDraftPreview: ({ draft, engine, model }: any) => (
    draft?.displayName
      ? {
          name: draft.displayName,
          team: draft.canSupervise === 'yes' ? 'black-gold' : draft.team,
          roleType: draft.canSupervise === 'yes' ? 'supervisor' : 'normal',
          avatar: { mode: 'deterministic', seed: draft.displayName, style: 'adventurer' },
          capabilities: [],
          systemPrompt: '',
          activeEngine: engine,
          engineModels: engine ? { [engine]: model } : {},
        }
      : null
  ),
}));

import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';

describe('AIAgentCreatorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClarifyAgent.mockImplementation(async (_input, handlers) => {
      const form = {
        type: 'clarification_form',
        summary: '需要确认职责边界。',
        knownFacts: ['用户需要修复助手'],
        missingFields: ['职责边界'],
        questions: [
          {
            id: 'responsibility_boundary',
            label: '职责边界',
            question: '这个 Agent 最核心的职责边界是什么？',
            selectionMode: 'single',
            options: [
              { id: 'execution', label: '执行推进', description: '偏实现、修复、补测试和落地交付。', recommended: true },
              { id: 'review', label: '审查裁定', description: '偏复核和质量门禁。' },
            ],
            placeholder: '例如：只负责代码修复和回归验证。',
            required: true,
          },
        ],
      };
      handlers?.onProgress?.({ stage: 'agent_clarification_question', message: 'AI 正在生成澄清问题。' });
      handlers?.onSession?.('agent-clarification-session-1');
      handlers?.onDelta?.('clarification output');
      handlers?.onItem?.({ kind: 'agent_clarification_question', data: form.questions[0] });
      handlers?.onForm?.(form);
      return {
        form,
        raw: 'clarification output',
        sessionId: 'agent-clarification-session-1',
      };
    });
    mockDraftAgent.mockImplementation(async (_input, handlers) => {
      handlers?.onProgress?.({ stage: 'draft-agent', message: 'AI 正在生成角色创建 item。' });
      handlers?.onSession?.('agent-draft-session-1');
      handlers?.onDelta?.('streaming output');
      handlers?.onItem?.({ kind: 'agent_config', data: { agent: { name: 'repair-agent' } } });
      handlers?.onValidation?.({ ok: true, issues: [] });
      return {
      draft: {
        name: 'repair-agent',
        team: 'red',
        roleType: 'normal',
        capabilities: ['修复'],
        systemPrompt: '修复问题',
        activeEngine: 'codex',
        engineModels: { codex: 'gpt-5-mini' },
      },
      raw: '',
      items: [],
      repairEvents: [],
      validation: { ok: true, issues: [] },
      };
    });
  });

  test('wraps dialog content with combobox portal provider', async () => {
    render(
      <AIAgentCreatorModal
        open={true}
        engine="openai"
        model="gpt-5"
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onContinueEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('dialog-root')).toBeTruthy();
    expect(screen.getByTestId('combobox-portal-provider')).toBeTruthy();
    expect(screen.getByText('默认阵营')).toBeTruthy();
    expect(screen.getAllByTestId('single-combobox').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(mockListAllConfigs).toHaveBeenCalled();
    });
  });

  test('passes selected engine and model when drafting an agent', async () => {
    const user = userEvent.setup();

    render(
      <AIAgentCreatorModal
        open={true}
        engine="openai"
        model="gpt-5"
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onContinueEdit={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText('例如：代码修复助手'), '修复助手');
    await user.type(screen.getByPlaceholderText('这个 Agent 负责什么工作、解决哪类问题、在团队里扮演什么角色。'), '负责修复问题');
    await user.selectOptions(screen.getByLabelText('engine-select'), 'codex');
    await user.selectOptions(screen.getByLabelText('model-select'), 'gpt-5-mini');
    await user.click(screen.getByRole('button', { name: '生成补充问题' }));

    await waitFor(() => {
      expect(mockClarifyAgent).toHaveBeenCalledWith(expect.objectContaining({
        engine: 'codex',
        model: 'gpt-5-mini',
        mode: 'create',
      }), expect.any(Object));
    });
    expect(await screen.findByText('职责边界')).toBeTruthy();
    await user.click(screen.getAllByText('执行推进')[0]);
    await user.click(screen.getByRole('button', { name: '提交回答并生成 Agent 草案' }));

    await waitFor(() => {
      expect(mockDraftAgent).toHaveBeenCalledWith(expect.objectContaining({
        engine: 'codex',
        model: 'gpt-5-mini',
        mode: 'create',
        clarificationAnswers: expect.stringContaining('执行推进'),
      }), expect.any(Object));
    });
    expect((await screen.findAllByText(/streaming output/)).length).toBeGreaterThan(0);
  });

  test('keeps preview avatar stable while typing and updates it after blur', async () => {
    const user = userEvent.setup();

    render(
      <AIAgentCreatorModal
        open={true}
        engine="openai"
        model="gpt-5"
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onContinueEdit={vi.fn()}
      />
    );

    const card = await screen.findByTestId('agent-hero-card');
    expect(card.getAttribute('data-avatar-seed')).toBe('新 Agent');

    await user.type(screen.getByPlaceholderText('这个 Agent 负责什么工作、解决哪类问题、在团队里扮演什么角色。'), '负责修复问题');
    expect(screen.getByTestId('agent-hero-card').getAttribute('data-avatar-seed')).toBe('新 Agent');

    await user.tab();
    expect(screen.getByTestId('agent-hero-card').getAttribute('data-avatar-seed')).toBe('负责修复问题');
  });

  test('keeps agent creation machine protocol out of visible AI output', async () => {
    const user = userEvent.setup();
    mockClarifyAgent.mockImplementationOnce(async (_input, handlers) => {
      const form = {
        type: 'clarification_form',
        summary: '需要确认职责边界。',
        knownFacts: ['用户需要修复助手'],
        missingFields: ['职责边界'],
        questions: [
          {
            id: 'responsibility_boundary',
            label: '职责边界',
            question: '这个 Agent 最核心的职责边界是什么？',
            selectionMode: 'single',
            options: [
              { id: 'execution', label: '执行推进', description: '偏实现、修复、补测试和落地交付。', recommended: true },
            ],
            required: true,
          },
        ],
      };
      const leaked = [
        '<ace-process>{"kind":"reasoning","body":"正在理解需求"}</ace-process>',
        '<result>{"kind":"agent_clarification_summary","data":{"summary":"机器块不应显示"}}</result>',
      ].join('\n');
      handlers?.onProgress?.({ stage: 'agent_clarification_summary', message: 'AI 正在生成当前理解摘要。' });
      handlers?.onDelta?.(leaked);
      handlers?.onForm?.(form);
      return {
        form,
        raw: leaked,
        sessionId: 'agent-clarification-session-2',
      };
    });

    render(
      <AIAgentCreatorModal
        open={true}
        engine="openai"
        model="gpt-5"
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onContinueEdit={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText('这个 Agent 负责什么工作、解决哪类问题、在团队里扮演什么角色。'), '负责修复问题');
    await user.click(screen.getByRole('button', { name: '生成补充问题' }));

    expect(await screen.findByTestId('wrapper-process-blocks')).toHaveTextContent('rendered process blocks');
    await waitFor(() => {
      const visibleText = screen.getByTestId('dialog-root').textContent || '';
      expect(visibleText).not.toContain('<ace-process>');
      expect(visibleText).not.toContain('</ace-process>');
      expect(visibleText).not.toContain('<result>');
      expect(visibleText).not.toContain('agent_clarification_summary');
      expect(visibleText).not.toContain('机器块不应显示');
    });
  });

  test('revises an existing agent and reuses the returned session for follow-up adjustments', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => true);
    const baseAgent = {
      name: 'repair-agent',
      team: 'red' as const,
      roleType: 'normal' as const,
      capabilities: ['修复'],
      systemPrompt: '修复问题',
      activeEngine: 'codex',
      engineModels: { codex: 'gpt-5' },
      tags: ['已有标签'],
      description: '负责修复问题',
    };

    render(
      <AIAgentCreatorModal
        open={true}
        mode="revise"
        baseAgent={baseAgent}
        engine="codex"
        model="gpt-5"
        onClose={vi.fn()}
        onCreate={onCreate}
        onContinueEdit={vi.fn()}
      />
    );

    expect(screen.getByText('修订引擎和模型')).toBeTruthy();
    expect(screen.queryByText('默认阵营')).toBeNull();
    expect(screen.queryByText('擅长领域')).toBeNull();
    expect(screen.queryByText('参考工作流')).toBeNull();
    expect(screen.queryByText('是否担任指挥官')).toBeNull();

    await user.type(screen.getByPlaceholderText('例如：让它更偏裁定席，补充回归验证和失败归因能力'), '补充裁定能力');
    await user.click(screen.getByRole('button', { name: '生成修订候选' }));

    expect(mockClarifyAgent).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockDraftAgent).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'revise',
        baseAgent,
        mission: '补充裁定能力',
        style: '',
        specialties: '',
        referenceWorkflow: '',
        clarificationAnswers: '',
      }), expect.any(Object));
    });
    expect((await screen.findAllByText(/streaming output/)).length).toBeGreaterThan(0);
    expect(onCreate).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发送调整' })).toBeTruthy();
    });
    await user.type(screen.getByPlaceholderText('例如：让它更偏裁定席，补充回归验证和失败归因能力'), '再加强回归验证');
    await user.click(screen.getByRole('button', { name: '发送调整' }));

    await waitFor(() => {
      expect(mockDraftAgent).toHaveBeenLastCalledWith(expect.objectContaining({
        mode: 'revise',
        sessionId: 'agent-draft-session-1',
        mission: '再加强回归验证',
      }), expect.any(Object));
    });

    await user.click(screen.getByRole('button', { name: '应用修订' }));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'repair-agent',
        team: 'red',
      }));
    });
  });
});
