// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import NewConfigModal from '@/components/NewConfigModal';

const mocks = vi.hoisted(() => ({
  createConfig: vi.fn(),
  createSession: vi.fn(),
  onSuccess: vi.fn(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChat: () => ({
    createSession: mocks.createSession,
    appendSessionMessage: vi.fn(async () => {}),
    updateSessionCreationBinding: vi.fn(async () => {}),
    appendVisibleSessionTag: vi.fn(async () => {}),
  }),
}));

vi.mock('@/components/WorkflowModeSelector', () => ({
  default: ({
    value,
    onChange,
    onAiGuidedCreate,
  }: {
    value: string;
    onChange: (mode: 'lightweight' | 'state-machine') => void;
    onAiGuidedCreate?: () => void;
  }) => (
    <div role="radiogroup" aria-label="工作流类型">
      <button type="button" role="radio" aria-checked={value === 'lightweight'} onClick={() => onChange('lightweight')}>轻量工作流</button>
      <button type="button" role="radio" aria-checked={value === 'state-machine'} onClick={() => onChange('state-machine')}>状态机</button>
      {onAiGuidedCreate ? <button type="button" aria-label="AI 引导创建工作流" onClick={onAiGuidedCreate}>AI 引导创建工作流</button> : null}
    </div>
  ),
}));

vi.mock('@/components/EngineModelSelect', () => ({
  EngineModelSelect: () => null,
}));

vi.mock('@/components/common/WorkspaceDirectoryPicker', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="工作目录选择器" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

vi.mock('@/components/workflow-templates/WorkflowTemplateBrowser', () => ({
  default: () => <div>模板库</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/combobox', () => ({
  ComboboxPortalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SingleCombobox: ({ value, onValueChange, options = [] }: any) => (
    <select aria-label="执行 Agent" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">请选择</option>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
  MultiCombobox: ({ value = [], onValueChange, options = [] }: any) => (
    <select aria-label="步骤 Skills" multiple value={value} onChange={(event) => onValueChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock('@/client/query/workflow-mutations', () => ({
  useCreateConfigMutation: () => ({ isPending: false, mutateAsync: mocks.createConfig }),
  useValidateConfigMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock('@/client/query/agents', () => ({
  useAgentsQuery: () => ({
    isLoading: false,
    data: { agents: [{ name: 'developer', description: '实现任务' }] },
  }),
}));

vi.mock('@/client/query/skills', () => ({
  useSkillsQuery: () => ({
    isLoading: false,
    data: { skills: [{ name: 'review-skill', description: '审查' }, { name: 'aceharness-tasklist', description: '锁定' }] },
  }),
}));

vi.mock('@/lib/core/api', () => ({
  agentApi: { listAgents: vi.fn(async () => ({ agents: [] })) },
}));

function createJsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderModal(props: Partial<React.ComponentProps<typeof NewConfigModal>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NewConfigModal
        isOpen
        onClose={vi.fn()}
        onSuccess={mocks.onSuccess}
        initialMode="lightweight"
        initialWorkflowName="任务清单工作流"
        initialRequirements="完成轻量工作流的实施和验收。"
        initialWorkingDirectory="C:/workspace/demo"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('NewConfigModal lightweight workflow creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSession.mockReturnValue('ai-session-1');
    mocks.createConfig.mockResolvedValue({ filename: 'tasklist-flow.yaml', message: '轻量工作流已创建' });
    vi.stubGlobal('fetch', vi.fn(async () => createJsonResponse({ configs: [] })));
  });

  test('renders the lightweight controls without topology or skill lock copy', async () => {
    renderModal();

    expect(await screen.findByText('轻量工作流设置')).toBeInTheDocument();
    expect(screen.getByLabelText(/任务清单目录/)).toHaveAttribute('readonly');
    expect(screen.queryByText('固定单步设计')).not.toBeInTheDocument();
    expect(screen.queryByText('aceharness-tasklist')).not.toBeInTheDocument();
    expect(screen.queryByText('已锁定')).not.toBeInTheDocument();
    expect(screen.queryByText('1 状态 · 1 步骤 · 无转移')).not.toBeInTheDocument();
    expect(screen.queryByText('阶段模式')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 引导创建工作流' })).toBeInTheDocument();
  });

  test('AI guided entry is separate from mode radios and switches to lightweight creation', async () => {
    renderModal({
      initialMode: 'state-machine',
      initialRequirements: '',
    });

    fireEvent.click(await screen.findByRole('button', { name: 'AI 引导创建工作流' }));

    expect(screen.getByRole('radio', { name: '轻量工作流' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(screen.getByDisplayValue(/我想围绕【目标】创建一个轻量工作流/)).toBeInTheDocument();
    });
    expect(mocks.createSession).toHaveBeenCalledWith({ title: 'AI 引导创建工作流' });
  });

  test('derives the tasklist directory from the filename without making it editable', async () => {
    renderModal();

    const directoryInput = await screen.findByLabelText(/任务清单目录/);
    const filenameInput = screen.getByLabelText(/文件名/);
    fireEvent.change(filenameInput, { target: { value: 'tasklist-flow.yaml' } });

    expect(directoryInput).toHaveValue('docs/tasklists/tasklist-flow');
    expect(directoryInput).toHaveAttribute('readonly');
  });

  test('submits optional skills for the lightweight step without a tasklist directory field', async () => {
    renderModal();

    await screen.findByText('轻量工作流设置');
    fireEvent.change(screen.getByLabelText(/文件名/), { target: { value: 'tasklist-flow.yaml' } });
    const skillsSelect = screen.getByLabelText('步骤 Skills') as HTMLSelectElement;
    const reviewSkill = Array.from(skillsSelect.options).find((option) => option.value === 'review-skill');
    if (!reviewSkill) throw new Error('Missing review-skill option');
    reviewSkill.selected = true;
    fireEvent.change(skillsSelect);
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(mocks.createConfig).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'lightweight',
        requirements: '完成轻量工作流的实施和验收。',
        skipSpecCoding: true,
        lightweight: {
          agent: 'developer',
          task: '完成轻量工作流的实施和验收。',
          skills: ['aceharness-tasklist', 'review-skill'],
        },
      }));
    });
    expect(mocks.createConfig.mock.calls[0][0].lightweight).not.toHaveProperty('tasklistDirectory');
    expect(mocks.onSuccess).toHaveBeenCalledWith('tasklist-flow.yaml', expect.anything());
  });

  test('restores lightweight requirements, agent, and derived directory from a creation session', async () => {
    const restoredSession = {
      id: 'lightweight-session-1',
      mode: 'lightweight',
      filename: 'restored-flow.yaml',
      workflowName: 'Restored Lightweight Flow',
      workingDirectory: 'C:/workspace/restored',
      workspaceMode: 'in-place',
      description: 'Restored session',
      requirements: '恢复需求摘要',
      lightweight: {
        agent: 'developer',
        task: '恢复后的轻量任务',
        skills: ['aceharness-tasklist'],
        tasklistDirectory: 'docs/tasklists/restored-flow',
      },
      specCoding: { persistMode: 'none', specRoot: '.spec' },
    };
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes('/api/spec-coding/sessions/lightweight-session-1')) {
        return createJsonResponse({ session: restoredSession });
      }
      return createJsonResponse({ configs: [] });
    });

    renderModal({
      resumeCreationSessionId: 'lightweight-session-1',
      initialRequirements: '',
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('restored-flow.yaml')).toBeInTheDocument();
      expect(screen.getByDisplayValue('恢复后的轻量任务')).toBeInTheDocument();
      expect(screen.getByLabelText('执行 Agent')).toHaveValue('developer');
      expect(screen.getByLabelText(/任务清单目录/)).toHaveValue('docs/tasklists/restored-flow');
    });
  });

  test('keeps the ordinary state-machine creation form and payload available', async () => {
    renderModal({
      initialMode: 'state-machine',
      initialRequirements: '构建一个普通状态机工作流。',
    });

    const requirements = await screen.findByLabelText(/需求描述/);
    expect(screen.getByRole('radio', { name: '状态机' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('参考已有工作流（可选）')).toBeInTheDocument();
    fireEvent.change(requirements, { target: { value: '构建一个普通状态机工作流。' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(mocks.createConfig).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'state-machine',
        requirements: '构建一个普通状态机工作流。',
      }));
    });
    expect(mocks.createConfig.mock.calls[0][0]).not.toHaveProperty('lightweight');
  });
});
