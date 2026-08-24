// @vitest-environment jsdom
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/client/query/agents', () => ({
  useAgentsQuery: () => ({ data: { agents: [] } }),
}));
vi.mock('@/client/query/skills', () => ({
  useSkillsQuery: () => ({ data: { skills: [] } }),
}));
vi.mock('@/client/query/configs', () => ({
  useConfigOptionsQuery: () => ({ data: { configs: [] }, isFetching: false, error: null }),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/combobox', () => ({
  ComboboxPortalProvider: ({ children }: any) => <>{children}</>,
  SingleCombobox: ({ value, placeholder }: any) => <div>{value || placeholder}</div>,
  MultiCombobox: ({ value = [], placeholder }: any) => <div>{value.length ? value.join(', ') : placeholder}</div>,
}));

import EditNodeModal, { getStepCapabilitySources } from '@/components/EditNodeModal';

const props = {
  isOpen: true,
  isNew: false,
  type: 'step',
  data: { name: '实现', agent: 'developer', task: '完成实现', skills: [] },
  roles: [{
    name: 'developer', team: 'blue', skills: ['agent-skill'], mcpServers: ['agent-mcp'],
  }],
  workflowSkills: ['workflow-skill'],
  workflowMcpServers: ['workflow-mcp'],
  availableMcpServers: [],
  mcpRegistryStatus: 'unavailable' as const,
  onClose: vi.fn(),
  onSave: vi.fn(),
};

describe('EditNodeModal capability sources', () => {
  test('explains step, Agent, and workflow capability sources when no step skill is bound', () => {
    render(<EditNodeModal {...props} />);

    expect(screen.getByText('本步骤的能力来源')).toBeTruthy();
    expect(screen.getAllByText('步骤专属').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Agent 继承').length).toBeGreaterThan(0);
    expect(screen.getAllByText('工作流继承').length).toBeGreaterThan(0);
    expect(screen.getByText('未额外绑定，仍继承下方 Agent / 工作流 Skills')).toBeTruthy();
    expect(screen.getByText('agent-skill')).toBeTruthy();
    expect(screen.getByText('workflow-skill')).toBeTruthy();
  });

  test('keeps configured MCP names visible and protected when the registry is unavailable', async () => {
    const onAgentMcpServersChange = vi.fn().mockResolvedValue(undefined);
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<EditNodeModal {...props} onAgentMcpServersChange={onAgentMcpServersChange} onSave={onSave} />);

    expect(screen.getAllByText('agent-mcp').length).toBeGreaterThan(0);
    expect(screen.getByText('workflow-mcp')).toBeTruthy();
    expect(screen.getByText('注册表未加载，以上已绑定名称会保留；运行前需校验。')).toBeTruthy();
    expect(screen.queryByText('当前没有可用 MCP Servers')).toBeNull();

    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(onAgentMcpServersChange).toHaveBeenCalledWith('developer', ['agent-mcp']));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ skills: [] }));
  });

  test('merges effective names while preserving their source groups', () => {
    expect(getStepCapabilitySources({
      step: ['step-only', 'shared'],
      agent: ['agent-only', 'shared'],
      workflow: ['workflow-only', 'shared'],
    })).toEqual({
      step: ['step-only', 'shared'],
      agent: ['agent-only', 'shared'],
      workflow: ['workflow-only', 'shared'],
      effective: ['workflow-only', 'shared', 'agent-only', 'step-only'],
    });
  });
});
