// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import NewConfigModal, { getWorkflowDisplayModeLabel } from '@/components/NewConfigModal';

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
  }: {
    value: string;
    onChange: (mode: 'lightweight' | 'state-machine' | 'ai-guided') => void;
  }) => (
    <div role="radiogroup" aria-label="工作流类型">
      <button type="button" role="radio" aria-checked={value === 'lightweight'} onClick={() => onChange('lightweight')}>轻量工作流</button>
      <button type="button" role="radio" aria-checked={value === 'state-machine'} onClick={() => onChange('state-machine')}>状态机</button>
      <button type="button" role="radio" aria-checked={value === 'ai-guided'} onClick={() => onChange('ai-guided')}>AI 引导创建</button>
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
  SingleCombobox: ({ value, onValueChange, options = [], disabled }: any) => (
    <select aria-label="执行 Agent" value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
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
    data: {
      agents: [
        { name: 'default-supervisor', roleType: 'supervisor', catalogVisibility: 'system', description: '系统协调' },
        { name: 'developer', team: 'red', description: '实现任务' },
      ],
    },
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
    window.localStorage.clear();
    mocks.createSession.mockReturnValue('ai-session-1');
    mocks.createConfig.mockResolvedValue({ filename: 'tasklist-flow.yaml', message: '轻量工作流已创建' });
    vi.stubGlobal('fetch', vi.fn(async () => createJsonResponse({ configs: [] })));
  });

  test('uses only supported labels for workflow preview modes', () => {
    expect(getWorkflowDisplayModeLabel({ workflow: { profile: 'lightweight' } })).toBe('轻量工作流');
    expect(getWorkflowDisplayModeLabel('state-machine')).toBe('状态机');
    expect(getWorkflowDisplayModeLabel('phase-based')).toBe('状态机');
  });

  test('renders the lightweight controls without topology or skill lock copy', async () => {
    renderModal();

    expect(await screen.findByText('轻量工作流设置')).toBeInTheDocument();
    expect(screen.queryByLabelText(/任务清单目录/)).not.toBeInTheDocument();
    expect(screen.queryByText('固定单步设计')).not.toBeInTheDocument();
    expect(screen.queryByText('aceharness-tasklist')).not.toBeInTheDocument();
    expect(screen.queryByText('已锁定')).not.toBeInTheDocument();
    expect(screen.queryByText('1 状态 · 1 步骤 · 无转移')).not.toBeInTheDocument();
    expect(screen.queryByText('阶段模式')).not.toBeInTheDocument();
    expect(screen.queryByText('线性流程')).not.toBeInTheDocument();
    expect(screen.queryByText('线性 workflow')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'AI 引导创建' })).toBeInTheDocument();
  });

  test('excludes the system Supervisor from the lightweight execution Agent selector', async () => {
    renderModal();

    const selector = await screen.findByLabelText('执行 Agent') as HTMLSelectElement;
    expect(Array.from(selector.options, (option) => option.value)).toContain('developer');
    expect(Array.from(selector.options, (option) => option.value)).not.toContain('default-supervisor');
  });

  test('selecting AI guided mode keeps its own selected state without creating a chat session', async () => {
    window.localStorage.setItem('aceharness.newConfig.specPlanningEnabled', '1');
    renderModal({
      initialMode: 'state-machine',
      initialRequirements: '',
    });

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Spec 计划模式' })).toHaveAttribute('aria-checked', 'true');
    });
    fireEvent.click(await screen.findByRole('radio', { name: 'AI 引导创建' }));

    expect(screen.getByRole('radio', { name: '轻量工作流' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: '状态机' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'AI 引导创建' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/我想创建一个代码审查工作流/)).toBeInTheDocument();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/api/chat/sessions'))).toBe(false);
  });

  test('submitting AI requirements creates the planning session and enters clarification', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    class TestEventSource extends EventTarget {
      readyState = 1;
      close() {
        this.readyState = 2;
      }
    }
    vi.stubGlobal('EventSource', TestEventSource);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      requests.push({ url, method });

      if (url.endsWith('/api/chat/sessions') && method === 'POST') {
        return createJsonResponse({ session: { id: 'planning-session-1', messages: [] } });
      }
      if (url.includes('/api/spec-coding/sessions') && method === 'POST') {
        return createJsonResponse({ session: { id: 'draft-session-1', status: 'draft' } });
      }
      if (url.includes('/api/chat/stream') && method === 'POST') {
        return new Response(JSON.stringify({ error: 'test stream boundary' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/chat/stream?checkActive=')) {
        return createJsonResponse({ found: false });
      }
      return createJsonResponse({ session: { id: 'draft-session-1', messages: [] }, configs: [] });
    });
    window.localStorage.setItem('aceharness.newConfig.specPlanningEnabled', '1');

    renderModal({
      initialMode: 'state-machine',
      initialRequirements: '',
    });

    fireEvent.click(await screen.findByRole('radio', { name: 'AI 引导创建' }));
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Spec 计划模式' })).toHaveAttribute('aria-checked', 'true');
    });
    expect(requests.filter((request) => request.url.endsWith('/api/chat/sessions') && request.method === 'POST')).toHaveLength(0);
    const requirements = await screen.findByPlaceholderText(/我想创建一个代码审查工作流/);
    fireEvent.change(requirements, { target: { value: '创建一个可审阅的代码检查工作流。' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    await waitFor(() => {
      expect(requests).toContainEqual(expect.objectContaining({
        url: expect.stringContaining('/api/chat/sessions'),
        method: 'POST',
      }));
    });
    expect(await screen.findByRole('heading', { name: '补充问答' })).toBeInTheDocument();
    expect(requests.filter((request) => request.url.endsWith('/api/chat/sessions') && request.method === 'POST')).toHaveLength(1);
  });

  test('defers recovery of an existing AI planning session until planning starts', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const restoredSession = {
      id: 'draft-session-1',
      status: 'draft',
      mode: 'state-machine',
      chatSessionId: 'planning-session-1',
      filename: 'recovered-workflow.yaml',
      workflowName: 'Recovered workflow',
      workingDirectory: 'C:/workspace/demo',
      workspaceMode: 'in-place',
      description: '',
      requirements: '恢复已有的 AI 规划。',
      stageSessions: {
        clarification: { frontendSessionId: 'planning-session-1' },
      },
      uiState: {
        formStep: 2,
        planningStage: 'awaiting-answers',
        clarificationForm: {
          type: 'clarification_form',
          summary: '已有澄清',
          knownFacts: [],
          missingFields: [],
          questions: [],
        },
        clarificationAnswers: {},
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      requests.push({ url, method });

      if (url.includes('/api/spec-coding/sessions?chatSessionId=home-session-1')) {
        return createJsonResponse({ sessions: [{ id: restoredSession.id, status: 'draft' }] });
      }
      if (url.includes(`/api/spec-coding/sessions/${restoredSession.id}`)) {
        return createJsonResponse({ session: restoredSession });
      }
      if (url.includes('/api/chat/sessions/')) {
        return createJsonResponse({ session: { id: url.split('/').pop(), messages: [] } });
      }
      return createJsonResponse({ configs: [] });
    }));
    window.localStorage.setItem('aceharness.newConfig.specPlanningEnabled', '1');

    renderModal({
      initialMode: 'state-machine',
      initialRequirements: '',
      frontendSessionId: 'home-session-1',
    });

    fireEvent.click(await screen.findByRole('radio', { name: 'AI 引导创建' }));
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Spec 计划模式' })).toHaveAttribute('aria-checked', 'true');
    });
    expect(requests.some((request) => request.url.includes('/api/spec-coding/sessions?chatSessionId=home-session-1'))).toBe(false);

    fireEvent.change(await screen.findByPlaceholderText(/我想创建一个代码审查工作流/), {
      target: { value: '恢复已有的 AI 规划。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    expect(await screen.findByRole('heading', { name: '补充问答' })).toBeInTheDocument();
    expect(requests.filter((request) => request.url.includes('/api/spec-coding/sessions?chatSessionId=home-session-1'))).toHaveLength(1);
    expect(requests.filter((request) => request.url.endsWith('/api/chat/sessions') && request.method === 'POST')).toHaveLength(0);
  });

  test('starts Spec planning disabled for a new state-machine workflow', async () => {
    renderModal({ initialMode: 'state-machine' });

    expect(await screen.findByRole('switch', { name: 'Spec 计划模式' })).toHaveAttribute('aria-checked', 'false');
  });

  test('keeps the derived tasklist directory out of the creation form', async () => {
    renderModal();

    await screen.findByText('轻量工作流设置');
    const filenameInput = screen.getByLabelText(/文件名/);
    fireEvent.change(filenameInput, { target: { value: 'tasklist-flow.yaml' } });

    expect(screen.queryByLabelText(/任务清单目录/)).not.toBeInTheDocument();
  });

  test('locks lightweight tasklist handling without exposing step skill configuration', async () => {
    renderModal();

    await screen.findByText('轻量工作流设置');
    fireEvent.change(screen.getByLabelText(/文件名/), { target: { value: 'tasklist-flow.yaml' } });
    expect(screen.queryByLabelText('步骤 Skills')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(mocks.createConfig).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'lightweight',
        requirements: '完成轻量工作流的实施和验收。',
        skipSpecCoding: true,
        lightweight: {
          agent: 'developer',
          task: '完成轻量工作流的实施和验收。',
        },
      }));
    });
    expect(mocks.createConfig.mock.calls[0][0].lightweight).not.toHaveProperty('tasklistDirectory');
    expect(mocks.createConfig.mock.calls[0][0].lightweight).not.toHaveProperty('skills');
    expect(mocks.onSuccess).toHaveBeenCalledWith('tasklist-flow.yaml', expect.anything());
  });

  test('shows a loading create action and rejects duplicate lightweight submissions', async () => {
    let resolveCreate!: (value: { filename: string; message: string }) => void;
    mocks.createConfig.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreate = resolve as (value: { filename: string; message: string }) => void;
    }));
    renderModal();

    await screen.findByText('轻量工作流设置');
    fireEvent.change(screen.getByLabelText(/文件名/), { target: { value: 'in-flight.yaml' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    const pendingButton = await screen.findByRole('button', { name: '创建中...' });
    expect(pendingButton).toBeDisabled();
    expect(screen.getByLabelText('执行 Agent')).toBeDisabled();
    expect(screen.getByLabelText(/完整目标/)).toBeDisabled();

    fireEvent.click(pendingButton);
    expect(mocks.createConfig).toHaveBeenCalledTimes(1);

    resolveCreate({ filename: 'in-flight.yaml', message: '轻量工作流已创建' });
    await waitFor(() => {
      expect(mocks.onSuccess).toHaveBeenCalledWith('in-flight.yaml', expect.anything());
    });
  });

  test('restores lightweight requirements and agent from a creation session', async () => {
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
      expect(screen.queryByLabelText(/任务清单目录/)).not.toBeInTheDocument();
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
