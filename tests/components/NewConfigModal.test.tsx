// @vitest-environment jsdom
import React from 'react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultChatContextMock } from '../helpers/component-wrapper';
import { cleanup, fireEvent, render, waitFor, screen } from '@testing-library/react';

const chatContextMock = {
  ...defaultChatContextMock,
  appendSessionMessage: vi.fn(async () => {}),
  updateSessionCreationBinding: vi.fn(async () => {}),
  appendVisibleSessionTag: vi.fn(async () => {}),
};

vi.mock('next/dynamic', () => ({
  default: () => function DynamicStub() {
    return <div data-testid="dynamic-stub" />;
  },
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChat: () => chatContextMock,
}));

vi.mock('@/components/WorkflowModeSelector', () => ({
  default: () => <div data-testid="workflow-mode-selector" />,
}));

vi.mock('@/components/EngineModelSelect', () => ({
  EngineModelSelect: () => <div data-testid="engine-model-select" />,
}));

vi.mock('@/components/common/WorkspaceDirectoryPicker', () => ({
  default: () => <div data-testid="workspace-directory-picker" />,
}));

vi.mock('@/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/chat/cards/UniversalCard', () => ({
  default: () => <div data-testid="universal-card" />,
}));

vi.mock('@/components/chat/ChatMessage', () => ({
  default: ({ message }: { message: { content?: string; cards?: any[] } }) => (
    <div data-testid="chat-message">
      <div data-testid="wrapper-process-blocks">{message.content}</div>
      {(message.cards || []).map((_: any, index: number) => (
        <div key={index} data-testid="universal-card" />
      ))}
    </div>
  ),
  ThinkingBot: () => <div data-testid="thinking-bot" />,
  WrapperProcessBlocks: ({ content }: { content: string }) => <div data-testid="wrapper-process-blocks">{content}</div>,
}));

vi.mock('@/components/ui/combobox', () => ({
  ComboboxPortalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SingleCombobox: ({ value, onValueChange, options = [] as Array<{ value: string; label: string }> }: any) => (
    <select
      data-testid="single-combobox"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@/lib/chat/chat-actions', () => ({
  parseActions: () => ({ text: '', actions: [], cards: [], sidebarHints: [] }),
}));

vi.mock('@/lib/ai/result-normalizers', () => ({
  extractPlanDraftResult: () => null,
}));

vi.mock('@/lib/core/api', () => ({
  agentApi: {
    listAgents: vi.fn(async () => ({ agents: [] })),
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
    <input ref={ref} {...props} />
  )),
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => (
    <textarea ref={ref} {...props} />
  )),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

vi.mock('@/components/ui/tabs', () => {
  const TabsContext = React.createContext<{ value?: string; onValueChange?: (value: string) => void }>({});
  return {
    Tabs: ({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children: React.ReactNode }) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </TabsContext.Provider>
    ),
    TabsContent: ({ value, children }: { value?: string; children: React.ReactNode }) => {
      const context = React.useContext(TabsContext);
      if (value && context.value && value !== context.value) return null;
      return <div>{children}</div>;
    },
    TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ value, children }: { value?: string; children: React.ReactNode }) => {
      const context = React.useContext(TabsContext);
      return <button type="button" onClick={() => value && context.onValueChange?.(value)}>{children}</button>;
    },
  };
});

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarImage: () => null,
}));

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

import NewConfigModal, {
  ModalAiGenerationPanel,
  getDisplayContentForAiStream,
  parseWorkflowRepairReasonForDisplay,
  resolveValidatedWorkflowDraftConfig,
  resolveWorkflowCreationItemAttempt,
} from '@/components/NewConfigModal';
import { SPEC_REQUIREMENT_KIND } from '@/lib/ai/workflow-creation-items';

type FetchCall = {
  url: string;
  method: string;
  body?: any;
};

function createJsonResponse(data: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

function renderNewConfigModal(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('NewConfigModal backend draft isolation', () => {
  const fetchCalls: FetchCall[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls.length = 0;
    localStorage.clear();
    localStorage.setItem('auth-token', 'token');
    chatContextMock.appendSessionMessage.mockClear();
    chatContextMock.updateSessionCreationBinding.mockClear();
    chatContextMock.appendVisibleSessionTag.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('bootstraps independent planning chat and creation session on open', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, method, body });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions?chatSessionId=parent-1' && method === 'GET') {
        return createJsonResponse({ sessions: [] });
      }
      if (url === '/api/chat/sessions' && method === 'POST') {
        return createJsonResponse({
          session: {
            id: 'planning-1',
            title: body?.title || '创建计划：新工作流',
            model: 'test-model',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }
      if (url === '/api/spec-coding/sessions' && method === 'POST') {
        return createJsonResponse({
          session: {
            id: 'draft-1',
            chatSessionId: body?.chatSessionId,
            filename: body?.filename,
            workflowName: body?.workflowName,
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            specCoding: { id: 'spec-1' },
          },
        });
      }
      if (url === '/api/chat/sessions/planning-1' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'planning-1',
            title: '创建计划：新工作流',
            model: 'test-model',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }
      if (url === '/api/chat/sessions/parent-1' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'parent-1',
            title: 'Parent Session',
            model: 'test-model',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }
      if (
        (url === '/api/chat/sessions/planning-1' || url === '/api/chat/sessions/parent-1')
        && method === 'PUT'
      ) {
        return createJsonResponse({ success: true });
      }
      if (url === '/api/spec-coding/sessions/draft-1' && method === 'PUT') {
        return createJsonResponse({ session: { id: 'draft-1' } });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
      />
    );

    await waitFor(() => {
      expect(fetchCalls.some((call) => call.url === '/api/chat/sessions' && call.method === 'POST')).toBe(true);
      expect(fetchCalls.some((call) => call.url === '/api/spec-coding/sessions' && call.method === 'POST')).toBe(true);
    });

    const draftCreateCall = fetchCalls.find((call) => call.url === '/api/spec-coding/sessions' && call.method === 'POST');
    expect(draftCreateCall?.body.chatSessionId).toBe('planning-1');
    expect(chatContextMock.updateSessionCreationBinding).toHaveBeenCalledWith(
      'planning-1',
      expect.objectContaining({ creationSessionId: 'draft-1' })
    );
    expect(chatContextMock.updateSessionCreationBinding).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({ creationSessionId: 'draft-1' })
    );
  });

  test('restores from backend resumeCreationSessionId instead of creating a new draft', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      fetchCalls.push({ url, method });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions/resume-1' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'resume-1',
            chatSessionId: 'planning-resume',
            mode: 'ai-guided',
            workflowName: '恢复中的工作流',
            filename: 'resume-workflow.yaml',
            referenceWorkflow: '',
            workingDirectory: '/tmp/resume',
            workspaceMode: 'in-place',
            description: '恢复描述',
            requirements: '恢复需求',
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            specCoding: {
              id: 'spec-resume',
              persistMode: 'none',
              specRoot: '.spec',
              artifacts: {},
            },
            uiState: {
              formStep: 1,
              workflowExperienceEnabled: false,
            },
          },
        });
      }
      if (url === '/api/spec-coding/sessions/resume-1' && method === 'PUT') {
        return createJsonResponse({ session: { id: 'resume-1' } });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
        resumeCreationSessionId="resume-1"
      />
    );

    await waitFor(() => {
      expect(fetchCalls.some((call) => call.url === '/api/spec-coding/sessions/resume-1' && call.method === 'GET')).toBe(true);
    });

    expect(fetchCalls.some((call) => call.url === '/api/chat/sessions' && call.method === 'POST')).toBe(false);
    expect(fetchCalls.some((call) => call.url === '/api/spec-coding/sessions' && call.method === 'POST')).toBe(false);
    expect(screen.getByDisplayValue('恢复中的工作流')).toBeTruthy();
    expect(screen.getByDisplayValue('resume-workflow.yaml')).toBeTruthy();
    expect((screen.getByLabelText('使用历史经验') as HTMLInputElement).checked).toBe(false);
  });

  test('creates workflow from template library entry inside the new config modal', async () => {
    const templateSummary = {
      source: 'builtin',
      id: 'software-delivery',
      version: '1.0.0',
      name: '软件交付',
      description: '完成设计、实现、测试和交付整理',
      category: '软件研发',
      tags: ['研发'],
      featured: true,
      mode: 'phase-based',
      digest: 'a'.repeat(64),
      versions: ['1.0.0'],
      visibility: 'builtin',
      editable: false,
      stateCount: 0,
      phaseCount: 2,
      stepCount: 2,
      parameterCount: 1,
      preCommandCount: 0,
      dependencies: {
        agents: ['default-supervisor', 'developer'],
        skills: [],
        mcpServers: [],
        subworkflows: [],
      },
    };
    const templateDetail = {
      ...templateSummary,
      manifest: {
        apiVersion: 'aceharness.io/v1alpha1',
        kind: 'WorkflowTemplate',
        metadata: {
          id: templateSummary.id,
          version: templateSummary.version,
          name: templateSummary.name,
          description: templateSummary.description,
          category: templateSummary.category,
          tags: ['研发'],
          featured: true,
        },
        spec: {
          entrypoint: 'workflow.yaml',
          mode: 'phase-based',
          compatibility: { aceharness: '^1.0.0' },
          parameters: [
            { id: 'workflowName', label: '工作流名称', type: 'string', bind: '/workflow/name', required: true, default: '软件交付' },
          ],
          dependencies: templateSummary.dependencies,
        },
      },
      workflow: {
        workflow: {
          name: '软件交付',
          supervisor: { enabled: true, agent: 'default-supervisor' },
          phases: [
            { name: '设计', steps: [{ name: '设计方案', agent: 'developer', task: 'design' }] },
            { name: '实现', steps: [{ name: '编码实现', agent: 'developer', task: 'implement' }] },
          ],
        },
        context: { projectRoot: '', workspaceMode: 'in-place' },
      },
    };
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, method, body });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/workflow-templates' && method === 'GET') {
        return createJsonResponse({ templates: [templateSummary], categories: ['软件研发'], issues: [] });
      }
      if (url.startsWith('/api/workflow-templates?source=') && method === 'GET') {
        return createJsonResponse({ template: templateDetail });
      }
      if (url === '/api/agents' && method === 'GET') {
        return createJsonResponse({
          agents: [
            { name: 'default-supervisor', team: 'black-gold', roleType: 'supervisor', engineModels: {}, activeEngine: '' },
            { name: 'developer', team: 'red', roleType: 'normal', engineModels: {}, activeEngine: '' },
          ],
        });
      }
      if (url === '/api/workflow-templates/instantiate' && method === 'POST') {
        return createJsonResponse({
          success: true,
          filename: 'modal-template.yaml',
          templateRef: { source: 'builtin', id: templateSummary.id, version: templateSummary.version, digest: templateSummary.digest },
        }, true, 201);
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '模板库' }));
    expect(await screen.findByText('软件交付')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /查看模板/ }));
    expect(await screen.findByText('流程结构')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /使用模板/ }));
    expect(await screen.findByText('从模板新建工作流')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('配置文件名'), { target: { value: 'modal-template.yaml' } });
    fireEvent.change(screen.getByLabelText(/工作流名称/), { target: { value: '弹窗模板实例' } });
    fireEvent.click(screen.getByRole('button', { name: /创建工作流/ }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('modal-template.yaml'));
    expect(onClose).toHaveBeenCalled();
    const instantiateCall = fetchCalls.find((call) => call.url === '/api/workflow-templates/instantiate');
    expect(instantiateCall?.body).toMatchObject({
      filename: 'modal-template.yaml',
      values: { workflowName: '弹窗模板实例' },
    });
  });

  test('sends historical experience preference and hides historical recommendation details when disabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, method, body });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({
          recommendations: {
            experiences: [{
              runId: 'run-historical',
              workflowName: '历史经验工作流',
              configFile: 'historical-reference.yaml',
              summary: '历史经验摘要',
              experience: ['复用历史经验'],
              nextFocus: ['补齐边界'],
            }],
            referenceWorkflow: {
              filename: 'historical-reference.yaml',
              name: '历史骨架模板',
              mode: 'state-machine',
              agents: ['developer'],
              supervisorAgent: 'default-supervisor',
              source: 'recommended-experience',
              autoApply: true,
            },
            recommendedAgents: ['developer'],
            recommendedSupervisorAgent: 'default-supervisor',
            availableStepAgents: ['developer'],
            availableSupervisorAgents: ['default-supervisor'],
            relationshipHints: [],
          },
        });
      }
      if (url === '/api/chat/sessions' && method === 'POST') {
        return createJsonResponse({
          session: {
            id: 'planning-experience',
            title: '创建计划：新工作流',
            model: 'test-model',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }
      if (url === '/api/spec-coding/sessions' && method === 'POST') {
        return createJsonResponse({
          session: {
            id: 'draft-experience',
            chatSessionId: body?.chatSessionId,
            filename: body?.filename,
            workflowName: body?.workflowName,
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            specCoding: { id: 'spec-experience' },
          },
        });
      }
      if (url === '/api/chat/sessions/planning-experience' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'planning-experience',
            title: '创建计划：新工作流',
            model: 'test-model',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }
      if (url === '/api/chat/sessions/planning-experience' && method === 'PUT') {
        return createJsonResponse({ success: true });
      }
      if (url === '/api/spec-coding/sessions/draft-experience' && method === 'PUT') {
        return createJsonResponse({ session: { id: 'draft-experience' } });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/我想创建一个代码审查工作流/), {
      target: { value: '需要创建一个代码审查状态机工作流' },
    });

    await waitFor(() => {
      expect(fetchCalls.some((call) => (
        call.url === '/api/configs/recommendations'
        && call.method === 'POST'
        && call.body?.useHistoricalExperience === true
      ))).toBe(true);
    });

    expect(screen.getByText('历史骨架模板')).toBeTruthy();
    expect(screen.getByText('历史经验工作流')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('使用历史经验'));

    await waitFor(() => {
      expect(fetchCalls.some((call) => (
        call.url === '/api/configs/recommendations'
        && call.method === 'POST'
        && call.body?.useHistoricalExperience === false
      ))).toBe(true);
    });

    expect(screen.getByText('不使用经验')).toBeTruthy();
    expect(screen.getByText('不自动套历史骨架')).toBeTruthy();
    expect(screen.queryByText('历史骨架模板')).toBeNull();
    expect(screen.queryByText('历史经验工作流')).toBeNull();
  });

  test('restores unfinished homepage creation by chat session after refresh and keeps visible tags', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, method, body });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions?chatSessionId=parent-1' && method === 'GET') {
        return createJsonResponse({
          sessions: [{
            id: 'unfinished-1',
            status: 'draft',
            updatedAt: 20,
          }],
        });
      }
      if (url === '/api/spec-coding/sessions/unfinished-1' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'unfinished-1',
            chatSessionId: 'planning-restore',
            homeChatSessionId: 'parent-1',
            mode: 'ai-guided',
            workflowName: '刷新恢复工作流',
            filename: 'restore-after-refresh.yaml',
            referenceWorkflow: '',
            workingDirectory: '/tmp/restore-after-refresh',
            workspaceMode: 'in-place',
            description: '恢复描述',
            requirements: '恢复需求',
            status: 'draft',
            createdAt: 1,
            updatedAt: 20,
            specCoding: {
              id: 'spec-unfinished',
              persistMode: 'none',
              specRoot: '.spec',
              artifacts: {},
            },
            uiState: {
              formStep: 3,
              planningStage: 'generating-plan',
              clarificationAnswers: {
                scope: { optionIds: ['api'], note: '覆盖 API 状态' },
              },
            },
          },
        });
      }
      if (url === '/api/chat/sessions/planning-restore' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'planning-restore',
            title: '创建计划：刷新恢复工作流',
            model: 'test-model',
            messages: [{
              id: 'tag-1',
              role: 'user',
              content: '创建工作流 · 刷新恢复工作流 · restore-after-refresh.yaml · 计划生成中',
              timestamp: 1,
            }],
            createdAt: 1,
            updatedAt: 20,
          },
        });
      }
      if (url === '/api/chat/sessions/parent-1' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'parent-1',
            title: 'Parent Session',
            model: 'test-model',
            messages: [{
              id: 'tag-parent',
              role: 'user',
              content: '创建工作流 · 刷新恢复工作流 · restore-after-refresh.yaml · 计划生成中',
              timestamp: 1,
            }],
            createdAt: 1,
            updatedAt: 20,
          },
        });
      }
      if (url === '/api/chat/stream?checkActive=planning-restore&streamScope=workflow-planning' && method === 'GET') {
        return createJsonResponse({ active: false });
      }
      if (
        (url === '/api/chat/sessions/planning-restore' || url === '/api/chat/sessions/parent-1')
        && method === 'PUT'
      ) {
        return createJsonResponse({ ok: true });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('刷新恢复工作流')).toBeTruthy();
    });
    expect(screen.getByText('restore-after-refresh.yaml')).toBeTruthy();
    expect(screen.getAllByText('计划生成').length).toBeGreaterThan(0);
    expect(fetchCalls.some((call) => call.url === '/api/chat/sessions' && call.method === 'POST')).toBe(false);
    expect(fetchCalls.some((call) => call.url === '/api/spec-coding/sessions' && call.method === 'POST')).toBe(false);
    expect(chatContextMock.updateSessionCreationBinding).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({ creationSessionId: 'unfinished-1', status: 'draft' })
    );
    expect(chatContextMock.updateSessionCreationBinding).toHaveBeenCalledWith(
      'planning-restore',
      expect.objectContaining({ creationSessionId: 'unfinished-1', status: 'draft' })
    );
    expect(chatContextMock.appendVisibleSessionTag).not.toHaveBeenCalled();
    expect(fetchCalls.find((call) => call.url === '/api/chat/sessions/parent-1' && call.method === 'GET')?.body).toBeUndefined();
    expect(fetchCalls.some((call) => (
      call.url === '/api/chat/sessions/parent-1'
      && call.method === 'PUT'
      && call.body?.creationSession?.creationSessionId === 'unfinished-1'
    ))).toBe(true);
  });

  test('keeps restored step 2 instead of falling back to step 1 after hydration completes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      fetchCalls.push({ url, method });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions/resume-step-2' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'resume-step-2',
            chatSessionId: 'planning-step-2',
            mode: 'ai-guided',
            workflowName: '第二步恢复',
            filename: 'resume-step-2.yaml',
            referenceWorkflow: '',
            workingDirectory: '/tmp/step-2',
            workspaceMode: 'in-place',
            description: '恢复描述',
            requirements: '恢复需求',
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            specCoding: {
              id: 'spec-step-2',
              persistMode: 'none',
              specRoot: '.spec',
              artifacts: {},
            },
            uiState: {
              formStep: 2,
              planningStage: 'awaiting-answers',
              clarificationForm: {
                type: 'clarification_form',
                summary: '请补充关键范围',
                knownFacts: [],
                missingFields: ['scope'],
                questions: [{
                  id: 'scope',
                  label: '范围',
                  question: '这次先覆盖哪一块？',
                  selectionMode: 'single',
                  options: [{ id: 'api', label: 'API', description: '只做 API', recommended: true }],
                }],
              },
              clarificationAnswers: {},
            },
          },
        });
      }
      if (url === '/api/spec-coding/sessions/resume-step-2' && method === 'PUT') {
        return createJsonResponse({ session: { id: 'resume-step-2' } });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
        resumeCreationSessionId="resume-step-2"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('补充问答').length).toBeGreaterThan(0);
      expect(screen.getByText('这次先覆盖哪一块？')).toBeTruthy();
    });

    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(screen.getAllByText('补充问答').length).toBeGreaterThan(0);
    expect(screen.getByText('这次先覆盖哪一块？')).toBeTruthy();
    expect(screen.queryByDisplayValue('第二步恢复')).toBeNull();
  });

  test('keeps partial clarification in step 2 while active AI generation continues', async () => {
    vi.stubGlobal('EventSource', class MockEventSource extends EventTarget {
      url: string;
      withCredentials = false;
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
      }

      close() {}
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      fetchCalls.push({ url, method });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions/partial-step-2' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'partial-step-2',
            chatSessionId: 'planning-partial',
            mode: 'ai-guided',
            workflowName: '部分出题恢复',
            filename: 'partial-step-2.yaml',
            referenceWorkflow: '',
            workingDirectory: '/tmp/partial',
            workspaceMode: 'in-place',
            description: '恢复描述',
            requirements: '恢复需求',
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            specCoding: {
              id: 'spec-partial-step-2',
              persistMode: 'none',
              specRoot: '.spec',
              artifacts: {},
            },
            uiState: {
              formStep: 2,
              planningStage: 'clarifying',
              clarificationForm: {
                type: 'clarification_form',
                summary: '已先生成目标问题',
                knownFacts: ['需要拆小点生成'],
                missingFields: ['scope'],
                questions: [{
                  id: 'target_outcome',
                  label: '目标结果',
                  question: '最终要交付什么？',
                  selectionMode: 'single',
                  options: [{ id: 'workflow', label: '工作流', description: '生成工作流配置', recommended: true }],
                }],
              },
              clarificationAnswers: {},
            },
          },
        });
      }
      if (url === '/api/chat/sessions/planning-partial' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'planning-partial',
            title: '创建计划：部分出题恢复',
            model: 'test-model',
            messages: [],
            createdAt: 1,
            updatedAt: 20,
          },
        });
      }
      if (url === '/api/chat/stream?checkActive=planning-partial&streamScope=workflow-planning' && method === 'GET') {
        return createJsonResponse({
          found: true,
          active: true,
          chatId: 'planning-stream-1',
          streamContent: '正在生成后续澄清问题',
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
        resumeCreationSessionId="partial-step-2"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('最终要交付什么？')).toBeTruthy();
      expect(screen.getByText('继续出题中')).toBeTruthy();
      expect(screen.getByText('生成补充问答表')).toBeTruthy();
    });

    expect(screen.queryByText('用当前回答生成计划')).toBeNull();
    expect(screen.queryByText('提交回答并生成计划')).toBeNull();
    expect(screen.getByText('停止出题')).toBeTruthy();
  });

  test('does not restore completed homepage creation and records completion tags for new draft', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, method, body });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions?chatSessionId=parent-1' && method === 'GET') {
        return createJsonResponse({
          sessions: [{
            id: 'done-1',
            status: 'config-generated',
            workflowName: '已完成工作流',
            filename: 'done.yaml',
            updatedAt: 30,
          }],
        });
      }
      if (url === '/api/chat/sessions' && method === 'POST') {
        return createJsonResponse({
          session: {
            id: 'planning-new',
            title: body?.title || '创建计划：新工作流',
            model: 'test-model',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }
      if (url === '/api/spec-coding/sessions' && method === 'POST') {
        return createJsonResponse({
          session: {
            id: 'draft-new',
            chatSessionId: body?.chatSessionId,
            homeChatSessionId: body?.homeChatSessionId,
            filename: body?.filename,
            workflowName: body?.workflowName,
            status: 'draft',
            createdAt: 40,
            updatedAt: 40,
            specCoding: { id: 'spec-new' },
          },
        });
      }
      if (url === '/api/chat/sessions/planning-new' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'planning-new',
            title: '创建计划：新工作流',
            model: 'test-model',
            messages: [],
            createdAt: 40,
            updatedAt: 40,
          },
        });
      }
      if (url === '/api/chat/sessions/parent-1' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'parent-1',
            title: 'Parent Session',
            model: 'test-model',
            messages: [{
              id: 'done-tag',
              role: 'user',
              content: '创建工作流 · 已完成工作流 · done.yaml · 配置已生成',
              timestamp: 30,
            }],
            createdAt: 1,
            updatedAt: 30,
          },
        });
      }
      if (
        (url === '/api/chat/sessions/planning-new' || url === '/api/chat/sessions/parent-1')
        && method === 'PUT'
      ) {
        return createJsonResponse({ ok: true });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
      />
    );

    await waitFor(() => {
      expect(fetchCalls.some((call) => call.url === '/api/spec-coding/sessions' && call.method === 'POST')).toBe(true);
    });

    expect(screen.queryByDisplayValue('已完成工作流')).toBeNull();
    const createdDraftCall = fetchCalls.find((call) => call.url === '/api/spec-coding/sessions' && call.method === 'POST');
    expect(createdDraftCall?.body.homeChatSessionId).toBe('parent-1');
    expect(chatContextMock.updateSessionCreationBinding).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({ creationSessionId: 'draft-new', status: 'draft' })
    );
    expect(chatContextMock.appendVisibleSessionTag).toHaveBeenCalledWith(
      'parent-1',
      expect.stringContaining('创建工作流 ·')
    );
    expect(chatContextMock.appendVisibleSessionTag).toHaveBeenCalledWith(
      'parent-1',
      expect.stringContaining('已开始')
    );
    expect(fetchCalls.some((call) => call.url === '/api/spec-coding/sessions/done-1' && call.method === 'GET')).toBe(false);
  });

  test('resolves formStep from stageSessions when uiState.formStep is stale (step 1 but clarification exists)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      fetchCalls.push({ url, method });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions/stale-step-1' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'stale-step-1',
            chatSessionId: 'planning-stale',
            mode: 'ai-guided',
            workflowName: '步骤回退测试',
            filename: 'stale-step.yaml',
            referenceWorkflow: '',
            workingDirectory: '/tmp/stale',
            workspaceMode: 'in-place',
            description: '',
            requirements: '测试需求',
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            stageSessions: {
              clarification: {
                frontendSessionId: 'planning-stale',
                runtimeSessionId: 'runtime-1',
                updatedAt: Date.now(),
              },
              specPlanning: {
                frontendSessionId: 'planning-stale',
                runtimeSessionId: 'runtime-1',
                updatedAt: Date.now(),
              },
            },
            specCoding: {
              id: 'spec-stale',
              version: 1,
              status: 'draft',
              title: '新工作流 SpecCoding',
              persistMode: 'none',
              artifacts: {
                requirements: '# 需求文档：新工作流\n\n## 简介\n新工作流 的需求澄清',
                design: '# 设计文档：新工作流\n\n## 概述\n使用 状态机 workflow',
                tasks: '',
              },
              phases: [],
              assignments: [],
              tasks: [],
              revisions: [{ id: 'r1', version: 1, summary: '初始', createdAt: new Date().toISOString() }],
            },
            uiState: {
              formStep: 1,
              planningStage: 'idle',
              clarificationAnswers: {},
            },
          },
        });
      }
      if (url === '/api/spec-coding/sessions/stale-step-1' && method === 'PUT') {
        return createJsonResponse({ session: { id: 'stale-step-1' } });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
        resumeCreationSessionId="stale-step-1"
      />
    );

    // Should resolve to step 3 (specPlanning exists) instead of stale step 1
    await waitFor(() => {
      expect(screen.getByText('计划生成')).toBeTruthy();
    });
  });

  test('resolves formStep to 4 when uiState.formStep was persisted as 4', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      fetchCalls.push({ url, method });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions/real-spec-1' && method === 'GET') {
        const longContent = 'A'.repeat(300);
        return createJsonResponse({
          session: {
            id: 'real-spec-1',
            chatSessionId: 'planning-real',
            mode: 'ai-guided',
            workflowName: '真实Spec测试',
            filename: 'real-spec.yaml',
            referenceWorkflow: '',
            workingDirectory: '/tmp/real',
            workspaceMode: 'in-place',
            description: '',
            requirements: '测试需求',
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            stageSessions: {
              clarification: { frontendSessionId: 'planning-real', runtimeSessionId: 'runtime-1', updatedAt: Date.now() },
              specPlanning: { frontendSessionId: 'planning-real', runtimeSessionId: 'runtime-1', updatedAt: Date.now() },
            },
            specCoding: {
              id: 'spec-real',
              version: 2,
              status: 'draft',
              title: '真实Spec',
              summary: '真实Spec 的创建期设计草案',
              persistMode: 'none',
              artifacts: {
                requirements: longContent,
                design: longContent,
                tasks: longContent,
              },
              phases: [{ id: 's1', title: '需求分析', objective: '分析', ownerAgents: ['architect'], status: 'pending' }],
              assignments: [{ agent: 'architect', responsibility: '负责需求分析', phaseIds: ['s1'] }],
              tasks: [],
              revisions: [{ id: 'r1', version: 1, summary: '初始', createdAt: new Date().toISOString() }],
              workflowName: '真实Spec测试',
              goals: ['测试'],
              nonGoals: [],
              constraints: [],
              requirements: [],
              checkpoints: [],
              progress: { overallStatus: 'pending', completedPhaseIds: [], activePhaseId: 's1', summary: '' },
            },
            workflowDraftSummary: {
              mode: 'state-machine',
              nodes: [{ name: '需求分析', detail: '分析', ownerAgents: ['architect'] }],
              assignments: [{ agent: 'architect', responsibility: '负责需求分析' }],
              sourceSummary: '草案已生成',
            },
            config: { workflow: { mode: 'state-machine', states: [{ name: '需求分析', steps: [{ agent: 'architect' }] }] } },
            uiState: {
              formStep: 4,
              planningStage: 'idle',
              clarificationAnswers: {},
            },
          },
        });
      }
      if (url === '/api/spec-coding/sessions/real-spec-1' && method === 'PUT') {
        return createJsonResponse({ session: { id: 'real-spec-1' } });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
        resumeCreationSessionId="real-spec-1"
      />
    );

    // Should resolve to step 4: Math.max(uiState.formStep=4, resolve=3) = 4
    await waitFor(() => {
      expect(screen.getByText('返回计划')).toBeTruthy();
    });
  });

  test('handleNextStep does not jump to step 4 when previewSession has skeleton specCoding', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, method, body });

      if (url === '/api/configs' && method === 'GET') {
        return createJsonResponse({ configs: [] });
      }
      if (url === '/api/configs/recommendations' && method === 'POST') {
        return createJsonResponse({ recommendations: null });
      }
      if (url === '/api/spec-coding/sessions/skeleton-1' && method === 'GET') {
        return createJsonResponse({
          session: {
            id: 'skeleton-1',
            chatSessionId: 'planning-skel',
            mode: 'ai-guided',
            workflowName: '骨架测试',
            filename: 'skeleton-test.yaml',
            referenceWorkflow: '',
            workingDirectory: '/tmp/skeleton',
            workspaceMode: 'in-place',
            description: '',
            requirements: '测试需求描述至少五个字',
            status: 'draft',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            stageSessions: {
              clarification: { frontendSessionId: 'planning-skel', runtimeSessionId: 'runtime-1', updatedAt: Date.now() },
            },
            specCoding: {
              id: 'spec-skel',
              version: 1,
              status: 'draft',
              title: '新工作流 SpecCoding',
              persistMode: 'none',
              artifacts: { requirements: '# 需求文档', design: '', tasks: '' },
              phases: [],
              assignments: [],
              tasks: [],
              revisions: [{ id: 'r1', version: 1, summary: '初始', createdAt: new Date().toISOString() }],
            },
            uiState: {
              formStep: 1,
              planningStage: 'idle',
              clarificationAnswers: {},
            },
          },
        });
      }
      if (url === '/api/spec-coding/sessions/skeleton-1' && method === 'PUT') {
        return createJsonResponse({ session: { id: 'skeleton-1' } });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    renderNewConfigModal(
      <NewConfigModal
        isOpen
        onClose={() => {}}
        onSuccess={() => {}}
        initialMode="ai-guided"
        frontendSessionId="parent-1"
        resumeCreationSessionId="skeleton-1"
      />
    );

    // Should resolve to step 2 (clarification exists, spec is skeleton) not step 4
    await waitFor(() => {
      expect(screen.getByText('补充问答')).toBeTruthy();
    });
    // Should NOT show step 4 content
    expect(screen.queryByText('返回修改')).toBeNull();
  });
});

describe('NewConfigModal AI process rendering helpers', () => {
  afterEach(() => {
    cleanup();
  });

  test('modal AI content hides machine result and workflow item JSON while preserving visible process stream', () => {
    const content = [
      '<ace-process>{"kind":"reasoning","body":"Checking requirements"}</ace-process>',
      'Visible answer',
      '<result>{"kind":"workflow_state_outline","data":{"states":[{"name":"实现"},{"name":"完成","isFinal":true}]}}</result>',
      '```json',
      '{"kind":"spec_requirement","data":{"id":"R1","title":"hidden"}}',
      '```',
    ].join('\n');

    render(<ModalAiGenerationPanel content={content} />);

    expect(screen.getByTestId('wrapper-process-blocks').textContent).toContain('Checking requirements');
    expect(screen.getByTestId('wrapper-process-blocks').textContent).toContain('Visible answer');
    expect(screen.getByTestId('wrapper-process-blocks').textContent).not.toContain('workflow_state_outline');
    expect(screen.getByTestId('wrapper-process-blocks').textContent).not.toContain('spec_requirement');
  });

  test('modal AI content keeps card payloads renderable without leaking raw JSON', () => {
    const content = [
      'Before card',
      '```json',
      '{"kind":"card","payload":{"header":{"title":"运行摘要"},"blocks":[{"type":"text","content":"已完成"}]}}',
      '```',
    ].join('\n');

    render(<ModalAiGenerationPanel content={content} />);

    expect(screen.getByTestId('wrapper-process-blocks').textContent).toContain('Before card');
    expect(screen.getByTestId('universal-card')).toBeTruthy();
    expect(screen.getByTestId('wrapper-process-blocks').textContent).not.toContain('运行摘要');
  });

  test('display helper strips result and draft side channels before modal rendering', () => {
    const display = getDisplayContentForAiStream([
      'Visible answer',
      '<result>{"kind":"workflow_state_outline","data":{"states":[{"name":"实现"},{"name":"完成","isFinal":true}]}}</result>',
      '```json',
      '{"kind":"spec_task","data":{"id":"T1.1","title":"hidden"}}',
      '```',
    ].join('\n'));

    expect(display).toContain('Visible answer');
    expect(display).not.toContain('<result>');
    expect(display).not.toContain('workflow_state_outline');
    expect(display).not.toContain('spec_task');
  });

  test('repair display helper turns structured validation errors into friendly fields', () => {
    const display = parseWorkflowRepairReasonForDisplay(
      '错误字段：data.steps.0.agent。问题：agent 不能是 default-supervisor。修改方式：改成普通执行 Agent，例如 developer。'
    );

    expect(display.field).toBe('data.steps.0.agent');
    expect(display.problem).toContain('default-supervisor');
    expect(display.fix).toContain('developer');
  });

  test('workflow confirmation can save a validated preview even when draft config state was cleared', () => {
    const previewConfig = {
      workflow: { name: 'Preview Workflow', phases: [] },
      context: { projectRoot: '/tmp/demo', workspaceMode: 'in-place' },
    };

    expect(resolveValidatedWorkflowDraftConfig({
      workflowDraftConfig: null,
      workflowDraftValidation: null,
      workflowDraftPreview: {
        source: 'result-json',
        filename: 'preview.yaml',
        config: previewConfig,
        yaml: 'workflow:\n  name: Preview Workflow\n',
        validation: { ok: true, issues: [] },
      },
    })).toBe(previewConfig);
  });

  test('workflow item attempt retries malformed output before accepting the item', () => {
    const step = {
      kind: SPEC_REQUIREMENT_KIND,
      name: 'requirement-1',
      title: '需求小点',
      guidance: '生成一条可归档的需求。',
    } as const;

    const retry = resolveWorkflowCreationItemAttempt({
      finalContent: '这轮只有说明文字，没有结构化 result。',
      step,
      attempt: 0,
      maxAttempts: 3,
    });

    expect(retry.status).toBe('retry');
    if (retry.status !== 'retry') return;
    expect(retry.nextAttempt).toBe(1);
    expect(retry.repairPrompt).toContain('只补发当前小点');
    expect(retry.repairPrompt).toContain('上一轮输出');

    const accepted = resolveWorkflowCreationItemAttempt({
      finalContent: [
        '<result>',
        JSON.stringify({
          kind: SPEC_REQUIREMENT_KIND,
          data: {
            title: '保留已发送消息',
            userStory: '用户希望请求失败时已经发送的内容不会被清空。',
          },
        }),
        '</result>',
      ].join('\n'),
      step,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') return;
    expect(accepted.result.kind).toBe(SPEC_REQUIREMENT_KIND);
    expect(accepted.result.data.title).toBe('保留已发送消息');
  });
});
