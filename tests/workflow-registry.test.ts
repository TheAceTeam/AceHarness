import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@/lib/workflow/manager', () => ({
  WorkflowManager: class MockWorkflowManager {
    getStatus() {
      return { status: 'idle' };
    }
    on() {}
    removeAllListeners() {}
  },
}));

vi.mock('@/lib/state-machine/workflow-manager', () => ({
  StateMachineWorkflowManager: class MockStateMachineWorkflowManager {
    getStatus() {
      return { status: 'idle' };
    }
    on() {}
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
});
