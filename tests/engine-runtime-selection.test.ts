import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const runtimeMockState = vi.hoisted(() => ({
  openCalls: 0,
  addonAvailabilityCalls: 0,
  libraryAvailabilityCalls: 0,
  kiroInstances: [] as Array<any>,
}));

vi.mock('@cangjielang/napi-cj', () => ({
  getDynamicLibraryExtension: () => '.dll',
  isNativeAddonAvailable: () => {
    runtimeMockState.addonAvailabilityCalls += 1;
    return false;
  },
  isNativeLibraryAvailable: () => {
    runtimeMockState.libraryAvailabilityCalls += 1;
    return false;
  },
  openCangjieNativeLibrary: () => {
    runtimeMockState.openCalls += 1;
    throw new Error('native should not be opened');
  },
  readLibraryBuildInfo: () => null,
  resolveLibraryArtifactPath: ({ root, name, target }: any) => join(root, 'artifacts', target, `${name}.dll`),
  resolveNativeTarget: () => 'win32-x64-msvc',
}));

class MockEngine extends EventEmitter {
  constructor() {
    super();
    runtimeMockState.kiroInstances.push(this);
  }

  async execute() {
    return { success: true, output: 'mock' };
  }

  cancel(): void {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getName(): string {
    return 'kiro-cli';
  }
}

vi.mock('@/lib/engines/kiro-cli-wrapper', () => ({
  KiroCliEngineWrapper: MockEngine,
}));

function writeEngineConfig(aceHome: string, config: Record<string, unknown>): void {
  writeFileSync(join(aceHome, '.engine.json'), JSON.stringify({
    engine: 'kiro-cli',
    updatedAt: new Date().toISOString(),
    ...config,
  }, null, 2), 'utf8');
}

describe('engine runtime selection', () => {
  let aceHome: string;

  beforeEach(() => {
    vi.resetModules();
    runtimeMockState.openCalls = 0;
    runtimeMockState.addonAvailabilityCalls = 0;
    runtimeMockState.libraryAvailabilityCalls = 0;
    runtimeMockState.kiroInstances.length = 0;
    aceHome = join(tmpdir(), `aceharness-engine-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(aceHome, { recursive: true });
    process.env.CSIHARNESS_HOME = aceHome;
  });

  test('engineRuntime=js does not probe or open napi-cj native addon', async () => {
    writeEngineConfig(aceHome, { engineRuntime: 'js' });

    const { createEngine } = await import('@/lib/engines/engine-factory');
    const engine = await createEngine('kiro-cli');

    expect(engine?.getName()).toBe('kiro-cli');
    expect(runtimeMockState.kiroInstances).toHaveLength(1);
    expect(runtimeMockState.addonAvailabilityCalls).toBe(0);
    expect(runtimeMockState.libraryAvailabilityCalls).toBe(0);
    expect(runtimeMockState.openCalls).toBe(0);
  });

  test('engineRuntime=auto falls back to JS wrapper when native runtime is unavailable', async () => {
    writeEngineConfig(aceHome, { engineRuntime: 'auto' });

    const { createEngine } = await import('@/lib/engines/engine-factory');
    const engine = await createEngine('kiro-cli');

    expect(engine?.getName()).toBe('kiro-cli');
    expect(runtimeMockState.kiroInstances).toHaveLength(1);
    expect(runtimeMockState.addonAvailabilityCalls).toBeGreaterThan(0);
    expect(runtimeMockState.openCalls).toBe(0);
  });

  test('engineRuntime=cangjie with fallback disabled returns null when native runtime is unavailable', async () => {
    writeEngineConfig(aceHome, {
      engineRuntime: 'cangjie',
      cangjieRuntime: {
        fallbackToJs: false,
      },
    });

    const { createEngine } = await import('@/lib/engines/engine-factory');
    const engine = await createEngine('kiro-cli');

    expect(engine).toBeNull();
    expect(runtimeMockState.kiroInstances).toHaveLength(0);
    expect(runtimeMockState.addonAvailabilityCalls).toBeGreaterThan(0);
    expect(runtimeMockState.openCalls).toBe(0);
  });
});
