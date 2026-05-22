import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { EngineDriver, EngineType } from '@/lib/engines/engine-factory';
import { MockEngine } from './helpers/mock-engine';

const createEngine = vi.fn();
const createEngineForDriver = vi.fn();
const getEngineAvailabilityReport = vi.fn();
const resolveEffectiveEngine = vi.fn();

vi.mock('@/lib/engines/engine-factory', () => ({
  createEngine: (...args: unknown[]) => createEngine(...args),
  createEngineForDriver: (...args: unknown[]) => createEngineForDriver(...args),
  getEngineAvailabilityReport: (...args: unknown[]) => getEngineAvailabilityReport(...args),
  resolveEffectiveEngine: (...args: unknown[]) => resolveEffectiveEngine(...args),
}));

describe('model diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getEngineAvailabilityReport.mockResolvedValue({
      available: true,
      drivers: {
        sdk: true,
        stdio: true,
      },
    });
    resolveEffectiveEngine.mockImplementation((engineId: string) => `${engineId}-effective`);
  });

  test('returns structured diagnostics when wrapper initialization fails', async () => {
    createEngine.mockRejectedValue(new Error('connect refused during wrapper init'));

    const { runModelDiagnostics } = await import('@/lib/models/diagnostics');
    const result = await runModelDiagnostics({
      engine: 'opencode',
      includeModelScore: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('connect refused during wrapper init');
    expect(result.engineDebug?.stages.map((stage) => [stage.id, stage.status])).toEqual([
      ['availability', 'passed'],
      ['create-engine', 'failed'],
    ]);
    expect(result.logs?.some((log) => log.message === '引擎 wrapper 初始化失败' && log.detail?.includes('connect refused'))).toBe(true);
  });

  test('captures wrapper log stream events into diagnostic logs', async () => {
    const engine = new MockEngine();
    engine.setName('mock-diagnostic-engine');
    engine.executeImpl = async (options) => {
      engine.emit('stream', {
        type: 'log',
        content: 'Raw SSE connected',
        metadata: {
          detail: `step=${options.step}`,
          level: 'info',
          verbose: true,
        },
      });
      engine.emit('stream', {
        type: 'session',
        content: 'ses-diagnostic',
      });
      const output = options.step === 'multi-turn' ? 'MEMORY=ACE_MEMORY_7319' : 'ACE_OK';
      engine.emit('stream', {
        type: 'text',
        content: output,
      });
      return {
        success: true,
        output,
        sessionId: 'ses-diagnostic',
      };
    };
    createEngine.mockResolvedValue(engine);

    const { runModelDiagnostics } = await import('@/lib/models/diagnostics');
    const result = await runModelDiagnostics({
      engine: 'opencode',
      includeModelScore: false,
    });

    expect(result.ok).toBe(true);
    expect(result.engineDebug?.observedEventTypes).toEqual(expect.arrayContaining(['log', 'session', 'text']));
    expect(result.logs?.some((log) => log.message === 'Raw SSE connected' && log.detail?.includes('single-turn'))).toBe(true);
    expect(result.logs?.some((log) => log.message === 'Raw SSE connected' && log.detail?.includes('multi-turn'))).toBe(true);
  });

  test('uses createEngineForDriver when diagnostics pins a driver', async () => {
    const engine = new MockEngine({
      success: true,
      output: 'ACE_OK',
      sessionId: 'ses-driver',
    });
    engine.executeImpl = async () => {
      engine.emit('stream', { type: 'session', content: 'ses-driver' });
      engine.emit('stream', { type: 'text', content: 'ACE_OK' });
      return {
        success: true,
        output: 'ACE_OK',
        sessionId: 'ses-driver',
      };
    };
    createEngineForDriver.mockResolvedValue(engine);

    const { runModelDiagnostics } = await import('@/lib/models/diagnostics');
    await runModelDiagnostics({
      engine: 'opencode',
      driver: 'sdk',
      includeModelScore: false,
    });

    expect(createEngineForDriver).toHaveBeenCalledWith('opencode' as EngineType, 'sdk' as EngineDriver);
  });
});
