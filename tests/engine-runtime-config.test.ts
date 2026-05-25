import { describe, expect, test } from 'vitest';
import {
  inferDriverForEffectiveEngine,
  normalizeEngineRuntime,
  resolveEngineRuntimeMode,
} from '@/lib/engines/cangjie-runtime-config';

describe('cangjie engine runtime config', () => {
  test('normalizes supported runtime modes', () => {
    expect(normalizeEngineRuntime('js')).toBe('js');
    expect(normalizeEngineRuntime('cangjie')).toBe('cangjie');
    expect(normalizeEngineRuntime('auto')).toBe('auto');
    expect(normalizeEngineRuntime('native')).toBeUndefined();
  });

  test('resolves per-engine runtime before top-level runtime', () => {
    expect(resolveEngineRuntimeMode({
      engineRuntime: 'js',
      cangjieRuntime: {
        enabled: true,
        engines: {
          opencode: 'cangjie',
        },
      },
    }, 'opencode-sdk')).toBe('cangjie');
  });

  test('disabled cangjie runtime forces js mode', () => {
    expect(resolveEngineRuntimeMode({
      engineRuntime: 'cangjie',
      cangjieRuntime: {
        enabled: false,
      },
    }, 'codex')).toBe('js');
  });

  test('infers driver from effective engine id', () => {
    expect(inferDriverForEffectiveEngine('claude-code-acp')).toBe('stdio');
    expect(inferDriverForEffectiveEngine('claude-code')).toBe('sdk');
    expect(inferDriverForEffectiveEngine('opencode-sdk')).toBe('sdk');
    expect(inferDriverForEffectiveEngine('opencode')).toBe('stdio');
    expect(inferDriverForEffectiveEngine('codex')).toBeUndefined();
  });
});
