import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const factoryMockState = vi.hoisted(() => ({
  kiroInstances: [] as Array<any>,
  codexInstances: [] as Array<any>,
}));

class MockEngine extends EventEmitter {
  constructor(
    private readonly name: string,
    private readonly sink: Array<any>,
  ) {
    super();
    sink.push(this);
  }

  async execute() {
    return {
      success: true,
      output: this.name,
    };
  }

  cancel(): void {}

  cleanup(): void {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getName(): string {
    return this.name;
  }
}

vi.mock('@/lib/engines/kiro-cli-wrapper', () => ({
  KiroCliEngineWrapper: class extends MockEngine {
    constructor() {
      super('kiro-cli', factoryMockState.kiroInstances);
    }
  },
}));

vi.mock('@/lib/engines/codex-wrapper', () => ({
  CodexEngineWrapper: class extends MockEngine {
    constructor() {
      super('codex', factoryMockState.codexInstances);
    }
  },
}));

describe('engine factory pooling', () => {
  beforeEach(() => {
    vi.resetModules();
    factoryMockState.kiroInstances.length = 0;
    factoryMockState.codexInstances.length = 0;
  });

  test('does not pool ACP wrapper instances but still pools non-ACP engines by session key', async () => {
    const { getOrCreateEngine } = await import('@/lib/engines/engine-factory');

    const firstAcp = await getOrCreateEngine('kiro-cli', 'session-1');
    const secondAcp = await getOrCreateEngine('kiro-cli', 'session-1');
    expect(firstAcp).not.toBe(secondAcp);
    expect(factoryMockState.kiroInstances).toHaveLength(2);

    const firstNonAcp = await getOrCreateEngine('codex', 'session-2');
    const secondNonAcp = await getOrCreateEngine('codex', 'session-2');
    expect(firstNonAcp).toBe(secondNonAcp);
    expect(factoryMockState.codexInstances).toHaveLength(1);
  });
});
