import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@/lib/workflow/manager', () => ({
  WorkflowManager: class MockWorkflowManager {
    private listeners = new Map<string, (data: any) => void>();
    getStatus() {
      return { status: 'idle' };
    }
    on(event: string, handler: (data: any) => void) {
      this.listeners.set(event, handler);
    }
    emitForTest(event: string, data: any) {
      this.listeners.get(event)?.(data);
    }
    removeAllListeners() {}
  },
}));

vi.mock('@/lib/state-machine/workflow-manager', () => ({
  StateMachineWorkflowManager: class MockStateMachineWorkflowManager {
    private listeners = new Map<string, (data: any) => void>();
    getStatus() {
      return { status: 'idle' };
    }
    on(event: string, handler: (data: any) => void) {
      this.listeners.set(event, handler);
    }
    emitForTest(event: string, data: any) {
      this.listeners.get(event)?.(data);
    }
    removeAllListeners() {}
  },
}));

vi.mock('@/lib/run/state-persistence', () => ({
  loadRunState: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/run/runtime-configs', () => ({
  ensureRuntimeConfigsSeeded: vi.fn().mockResolvedValue(undefined),
  getRuntimeWorkflowConfigPath: vi.fn().mockResolvedValue('/tmp/workflow.yaml'),
  getBundledWorkflowConfigPath: vi.fn().mockReturnValue('/tmp/bundled-workflow.yaml'),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('workflow:\n  mode: state-machine\n'),
}));

vi.mock('yaml', () => ({
  parse: vi.fn().mockReturnValue({ workflow: { mode: 'state-machine' } }),
}));

describe('workflow registry', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as any).__workflowRegistry;
  });

  test('deduplicates concurrent manager creation for the same config file', async () => {
    let releaseRead!: () => void;
    const readGate = new Promise<string>((resolve) => {
      releaseRead = () => resolve('workflow:\n  mode: state-machine\n');
    });
    const { readFile } = await import('fs/promises');
    (readFile as any).mockReturnValue(readGate);

    const { workflowRegistry } = await import('@/lib/workflow/registry');
    const first = workflowRegistry.getManager('demo.yaml');
    const second = workflowRegistry.getManager('demo.yaml');

    releaseRead();

    const [firstManager, secondManager] = await Promise.all([first, second]);
    expect(firstManager).toBe(secondManager);
  });

  test('forwards state-machine parallel events with config identity', async () => {
    const { readFile } = await import('fs/promises');
    (readFile as any).mockResolvedValue('workflow:\n  mode: state-machine\n');

    const { workflowRegistry } = await import('@/lib/workflow/registry');
    const manager = await workflowRegistry.getManager('demo.yaml');
    const received = new Promise<any>((resolve) => {
      workflowRegistry.once('parallel-group-complete', resolve);
    });

    (manager as any).emitForTest('parallel-group-complete', {
      state: '实现',
      groupId: 'branch-a',
      passed: true,
    });

    await expect(received).resolves.toMatchObject({
      state: '实现',
      groupId: 'branch-a',
      passed: true,
      __configFile: 'demo.yaml',
    });
  });
});
