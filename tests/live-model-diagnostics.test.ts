import { beforeEach, expect, test, vi } from 'vitest';
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

const GLM_51_DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240"><title>Pelican riding a bicycle / 鹈鹕骑自行车</title><circle id="rear-wheel" cx="105" cy="185" r="28" fill="none" stroke="#555" stroke-width="3"/><circle id="front-wheel" cx="248" cy="185" r="28" fill="none" stroke="#555" stroke-width="3"/><path id="bike-frame" d="M155,142 L155,172 L105,185 M155,172 L248,185 M155,142 L225,145 L248,185" fill="none" stroke="#777" stroke-width="3.5" stroke-linejoin="round"/><line id="handlebar" x1="225" y1="145" x2="240" y2="128" stroke="#777" stroke-width="3" stroke-linecap="round"/><line x1="240" y1="128" x2="215" y2="125" stroke="#777" stroke-width="3" stroke-linecap="round"/><ellipse id="seat" cx="155" cy="137" rx="14" ry="5" fill="#666" stroke="#444" stroke-width="1.5"/><rect id="pedal" x="150" y="176" width="10" height="4" rx="1" fill="#888" stroke="#555" stroke-width="1"/><ellipse id="pelican-body" cx="160" cy="112" rx="30" ry="24" fill="#f8f8f0" stroke="#c8c8b0" stroke-width="1.5"/><path id="pelican-beak" d="M185,95 L230,88 L228,93 L185,100 Z" fill="#e8a830" stroke="#c08020" stroke-width="1.2"/><path id="pelican-pouch" d="M185,100 Q195,120 185,118 Q175,116 185,100 Z" fill="#f0c050" stroke="#d09030" stroke-width="1" opacity="0.8"/><path id="pelican-wing" d="M140,108 Q120,80 135,95 Q150,85 165,100" fill="#e8e0d0" stroke="#b8b0a0" stroke-width="1.5"/><circle cx="190" cy="92" r="3" fill="#222"/><line id="pelican-leg" x1="165" y1="132" x2="155" y2="172" stroke="#d09030" stroke-width="2.5" stroke-linecap="round"/><line x1="155" y1="172" x2="150" y2="178" stroke="#d09030" stroke-width="2" stroke-linecap="round"/><ellipse cx="165" cy="88" rx="18" ry="14" fill="#f8f8f0" stroke="#c8c8b0" stroke-width="1"/><circle cx="105" cy="185" r="3" fill="#555"/><circle cx="248" cy="185" r="3" fill="#555"/><path d="M105,185 L105,185 M248,185 L248,185" fill="none"/><path d="M225,145 L248,165 L248,185" fill="none" stroke="#777" stroke-width="3" stroke-linejoin="round"/></svg>`;

const GLM_5_DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240" width="360" height="240">
  <title>Pelican riding a bicycle - 鹈鹕骑自行车</title>
  <circle id="front-wheel" cx="280" cy="180" r="35" fill="none" stroke="#333" stroke-width="6"/>
  <circle id="rear-wheel" cx="120" cy="180" r="35" fill="none" stroke="#333" stroke-width="6"/>
  <path id="bike-frame" d="M120 180 L180 140 L240 140 L280 180 M180 140 L180 180 M240 140 L280 100" fill="none" stroke="#444" stroke-width="5"/>
  <path id="handlebar" d="M270 95 L290 85 M275 90 L285 80" fill="none" stroke="#444" stroke-width="4" stroke-linecap="round"/>
  <ellipse id="seat" cx="175" cy="133" rx="20" ry="8" fill="#555"/>
  <ellipse id="pedal" cx="200" cy="175" rx="12" ry="6" fill="#555" transform="rotate(-20 200 175)"/>
  <ellipse id="pelican-body" cx="200" cy="100" rx="50" ry="35" fill="#f5f5f5" stroke="#ddd"/>
  <path id="pelican-wing" d="M170 90 Q140 100 150 130 Q180 120 190 110 Z" fill="#e8e8e8" stroke="#ccc"/>
  <path id="pelican-beak" d="M245 90 L310 85 L300 100 L245 100 Z" fill="#f9a825" stroke="#e65100"/>
  <path id="pelican-pouch" d="M245 100 Q280 130 300 100 L245 100 Z" fill="#ffb74d" stroke="#f57c00" opacity="0.8"/>
  <line id="pelican-leg" x1="190" y1="130" x2="200" y2="165" stroke="#e65100" stroke-width="4"/>
  <circle cx="250" cy="85" r="8" fill="#f5f5f5"/>
</svg>`;

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
  createEngineForDriver.mockImplementation(() => createEngine());
  createEngine.mockImplementation(() => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      let output = 'ACE_OK';
      if (options.step === 'multi-turn') {
        output = 'MEMORY=ACE_MEMORY_7319';
      } else if (options.step === 'cap-drawing-pelican') {
        output = String(options.model || '').includes('5.1') ? GLM_51_DRAWING : GLM_5_DRAWING;
      }
      engine.emit('stream', { type: 'session', content: 'ses-svg-regression' });
      engine.emit('stream', { type: 'text', content: output });
      return {
        success: true,
        output,
        sessionId: 'ses-svg-regression',
      };
    };
    return engine;
  });
});

test('replays the live pelican SVG results and preserves score separation', async () => {
  const { runModelDiagnostics } = await import('@/lib/models/diagnostics');

  const glm51 = await runModelDiagnostics({
    engine: 'opencode',
    model: 'glm-5.1',
    modelCapabilityIds: ['drawing_pelican'],
  });
  const glm5 = await runModelDiagnostics({
    engine: 'opencode',
    model: 'glm-5',
    modelCapabilityIds: ['drawing_pelican'],
  });

  const drawing51 = glm51.modelEvaluation?.capabilities.find((item) => item.id === 'drawing_pelican');
  const drawing5 = glm5.modelEvaluation?.capabilities.find((item) => item.id === 'drawing_pelican');

  expect(drawing51?.score).toBe(97);
  expect(drawing5?.score).toBe(81);
  expect(drawing51?.score).toBeGreaterThan(drawing5?.score || 0);
  expect(drawing51?.metrics).toMatchObject({
    shapeCount: 19,
    extraShapeCount: 8,
  });
  expect(drawing5?.metrics).toMatchObject({
    shapeCount: 12,
    extraShapeCount: 1,
  });
  expect(drawing51?.evidence).toEqual(expect.arrayContaining([
    '图形细节较丰富：19 个图形元素',
    '除必需部件外还有较多补充细节：8',
  ]));
  expect(drawing5?.evidence).toEqual(expect.arrayContaining([
    '图形元素达到可读细节量：12',
    '额外细节偏少，接近最低限度作图',
  ]));
});
