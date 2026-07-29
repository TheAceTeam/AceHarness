// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import WorkflowTemplatesPanel from '@/components/workflow-templates/WorkflowTemplatesPanel';
import { ToastProvider } from '@/components/ui/toast';

vi.mock('@/components/common/WorkspaceDirectoryPicker', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="工作目录选择" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const summary = {
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
  parameterCount: 2,
  preCommandCount: 0,
  dependencies: {
    agents: ['default-supervisor', 'developer'],
    skills: [],
    mcpServers: [],
    subworkflows: [],
  },
} as const;

const detail = {
  ...summary,
  manifest: {
    apiVersion: 'csiharness.io/v1alpha1',
    kind: 'WorkflowTemplate',
    metadata: {
      id: summary.id,
      version: summary.version,
      name: summary.name,
      description: summary.description,
      category: summary.category,
      tags: ['研发'],
      featured: true,
    },
    spec: {
      entrypoint: 'workflow.yaml',
      mode: 'phase-based',
      compatibility: { csiharness: '^0.1.0' },
      parameters: [
        { id: 'workflowName', label: '工作流名称', type: 'string', bind: '/workflow/name', required: true, default: '软件交付' },
        { id: 'projectRoot', label: '工作目录', type: 'directory', bind: '/context/projectRoot', required: true },
      ],
      dependencies: summary.dependencies,
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
} as const;

describe('WorkflowTemplatesPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/agents')) {
        return jsonResponse({
          agents: [
            { name: 'default-supervisor', team: 'black-gold', roleType: 'supervisor', engineModels: {}, activeEngine: '' },
            { name: 'developer', team: 'red', roleType: 'normal', engineModels: {}, activeEngine: '' },
          ],
        });
      }
      if (url.includes('/api/workflow-templates/instantiate') && init?.method === 'POST') {
        return jsonResponse({
          success: true,
          filename: 'delivery.yaml',
          templateRef: { source: 'builtin', id: summary.id, version: summary.version, digest: summary.digest },
        }, 201);
      }
      if (url.includes('/api/workflow-templates?source=')) {
        return jsonResponse({ template: detail });
      }
      if (url.includes('/api/workflow-templates')) {
        return jsonResponse({ templates: [summary], categories: ['软件研发'], issues: [] });
      }
      return jsonResponse({});
    }));
  });

  test('opens template details and creates a parameterized workflow', async () => {
    const onInstantiated = vi.fn();
    renderPanel(<WorkflowTemplatesPanel onInstantiated={onInstantiated} />);

    expect(await screen.findByText('软件交付')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看模板/ }));
    expect(await screen.findByText('流程结构')).toBeInTheDocument();
    expect(screen.getByText('设计')).toBeInTheDocument();
    expect(screen.getByText('工作流名称')).toBeInTheDocument();
    const developerLink = screen.getAllByRole('link', { name: /developer/ })[0];
    expect(developerLink.getAttribute('href')).toBe('/agents?agent=developer');
    expect(developerLink.getAttribute('target')).toBe('_blank');

    fireEvent.click(screen.getByRole('button', { name: /使用模板/ }));
    expect(await screen.findByRole('heading', { name: '从模板新建工作流' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('配置文件名'), { target: { value: 'delivery.yaml' } });
    fireEvent.change(await screen.findByLabelText(/工作流名称/), { target: { value: '交付实例' } });
    fireEvent.change(screen.getByLabelText('工作目录选择'), { target: { value: '/tmp/project' } });
    fireEvent.click(screen.getByRole('button', { name: /创建工作流/ }));

    await waitFor(() => expect(onInstantiated).toHaveBeenCalledWith('delivery.yaml'));
    const instantiateCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/api/workflow-templates/instantiate'));
    expect(instantiateCall).toBeTruthy();
    expect(JSON.parse(String(instantiateCall?.[1]?.body))).toMatchObject({
      filename: 'delivery.yaml',
      values: { workflowName: '交付实例', projectRoot: '/tmp/project' },
    });
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPanel(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}
