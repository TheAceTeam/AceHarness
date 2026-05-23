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

  test('scores the harder pelican, math, reasoning, and consistency probes from exact answers', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      const outputs: Record<string, string> = {
        'single-turn': 'ACE_OK',
        'multi-turn': 'MEMORY=ACE_MEMORY_7319',
        'cap-drawing-pelican': '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240"><title>Pelican riding bicycle</title><circle id="rear-wheel" cx="85" cy="190" r="28" fill="none" stroke="#444" stroke-width="3"/><circle id="front-wheel" cx="265" cy="190" r="28" fill="none" stroke="#444" stroke-width="3"/><path id="bike-frame" d="M85 190L170 155L265 190L170 155L155 130L85 190M170 155L265 155L265 190" fill="none" stroke="#555" stroke-width="2.5"/><line id="handlebar" x1="248" y1="140" x2="278" y2="140" stroke="#555" stroke-width="3" stroke-linecap="round"/><ellipse id="seat" cx="157" cy="126" rx="14" ry="5" fill="#777" stroke="#555" stroke-width="1.5"/><rect id="pedal" x="168" y="170" width="18" height="4" rx="2" fill="#666" stroke="#444" stroke-width="1"/><ellipse id="pelican-body" cx="155" cy="100" rx="38" ry="28" fill="#e8e0d0" stroke="#b0a090" stroke-width="1.5"/><path id="pelican-wing" d="M130 88Q110 70 115 55Q125 50 140 60L150 75Z" fill="#d4c8b8" stroke="#a09080" stroke-width="1.5"/><path id="pelican-beak" d="M185 78L235 72L230 80L185 85Z" fill="#f0a030" stroke="#d08020" stroke-width="1.5"/><path id="pelican-pouch" d="M185 85Q210 100 230 80Q215 95 185 88Z" fill="#f0c060" stroke="#d09030" stroke-width="1" opacity="0.8"/><line id="pelican-leg" x1="168" y1="125" x2="172" y2="170" stroke="#d08020" stroke-width="3" stroke-linecap="round"/><line x1="170" y1="155" x2="170" y2="170" stroke="#555" stroke-width="2"/><line x1="172" y1="170" x2="178" y2="172" stroke="#d08020" stroke-width="2" stroke-linecap="round"/><circle cx="253" cy="147" r="3" fill="#555"/><circle cx="185" cy="80" r="4" fill="#222"/><path d="M190 82Q192 84 188 84" fill="none" stroke="#222" stroke-width="0.8"/><path d="M85 190Q85 182 93 182Q85 182 85 190" fill="#444" stroke="#444"/><path d="M265 190Q265 182 273 182Q265 182 265 190" fill="#444" stroke="#444"/></svg>',
        'cap-math': JSON.stringify({
          pairPartitionCount: 144,
          cyclicExteriorSignature: 1565,
          newBoxVolume: 30,
          harmonicRemainderMod17: 5,
          fourthCombinedTerm: 206,
          constrainedStringCount: 1296,
          minEdgeSum: 337,
          steps: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
        }),
        'cap-reasoning': JSON.stringify({
          truthTellers: 7,
          liars: 6,
          alternatersOddTruth: 9,
          alternatersEvenTruth: 9,
          truthCandyTotal: 7,
          repeatingIntegers: [111, 222, 333, 444, 481, 518, 555, 592, 629, 666, 777, 888, 999],
          twoPassOrderings: 8178,
          trapezoidRatio: '1/3',
          returnStep: 359,
          steps: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
        }),
        'cap-consistency': 'BC_OVER_AD=1/3',
        'cap-consistency-repeat': 'BC_OVER_AD = 1 / 3',
      };
      const output = outputs[options.step] || 'ACE_OK';
      engine.emit('stream', { type: 'session', content: 'ses-scored' });
      engine.emit('stream', { type: 'text', content: output });
      return {
        success: true,
        output,
        sessionId: 'ses-scored',
      };
    };
    createEngine.mockResolvedValue(engine);

    const { runModelDiagnostics } = await import('@/lib/models/diagnostics');
    const result = await runModelDiagnostics({
      engine: 'opencode',
      model: 'glm-5.1',
      modelCapabilityIds: ['drawing_pelican', 'math', 'reasoning', 'consistency'],
    });

    expect(result.ok).toBe(true);
    expect(result.modelEvaluation?.overallScore).toBeGreaterThanOrEqual(85);
    const capabilities = new Map((result.modelEvaluation?.capabilities || []).map((item) => [item.id, item]));
    expect(capabilities.get('drawing_pelican')?.score).toBeGreaterThanOrEqual(90);
    expect(capabilities.get('math')?.score).toBe(80);
    expect(capabilities.get('math')?.metrics.correctCount).toBe(7);
    expect(capabilities.get('reasoning')?.score).toBe(100);
    expect(capabilities.get('consistency')?.score).toBe(100);
    expect(capabilities.get('consistency')?.metrics).toMatchObject({
      first: 'BC_OVER_AD=1/3',
      second: 'BC_OVER_AD=1/3',
    });
  });

  test('does not let the old relay topology svg pass as a pelican drawing', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      const output = options.step === 'cap-drawing-pelican'
        ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240"><title>relay audit topology</title><rect x="12" y="16" width="88" height="40"/><rect x="132" y="16" width="88" height="40"/><rect x="252" y="16" width="88" height="40"/><line x1="100" y1="36" x2="132" y2="36"/><line x1="220" y1="36" x2="252" y2="36"/><text x="26" y="40">gateway</text><text x="150" y="40">provider</text><text x="266" y="40">relay</text></svg>'
        : options.step === 'multi-turn'
          ? 'MEMORY=ACE_MEMORY_7319'
          : 'ACE_OK';
      engine.emit('stream', { type: 'session', content: 'ses-topology' });
      engine.emit('stream', { type: 'text', content: output });
      return {
        success: true,
        output,
        sessionId: 'ses-topology',
      };
    };
    createEngine.mockResolvedValue(engine);

    const { runModelDiagnostics } = await import('@/lib/models/diagnostics');
    const result = await runModelDiagnostics({
      engine: 'opencode',
      modelCapabilityIds: ['drawing_pelican'],
    });

    const drawing = result.modelEvaluation?.capabilities.find((item) => item.id === 'drawing_pelican');
    expect(drawing?.score).toBeLessThan(50);
    expect(drawing?.status).toBe('failed');
    expect(drawing?.evidence.some((item) => item.includes('relay 拓扑图'))).toBe(true);
  });
});
