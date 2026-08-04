import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { parse } from 'yaml';

const agentsDir = path.resolve('configs/agents');
const outDir = path.resolve('tmp/imagegen/office-agents');
const publicOutDir = 'public/office/agents';

const roles = [
  'default-supervisor',
  'product-manager',
  'architect',
  'developer',
  'tester',
  'code-judge',
];

const visualProfiles = {
  'default-supervisor': 'calm workflow supervisor, refined dark business-casual outfit, composed coordination presence',
  'product-manager': 'thoughtful product lead, smart casual outfit, holding a small tablet, approachable strategist',
  architect: 'senior software architect, minimalist dark jacket, analytical and composed, subtle blueprint motif',
  developer: 'focused software engineer, hoodie layered with clean workwear, practical and energetic',
  tester: 'quality engineer, neat utility vest, observant expression, small checklist tablet',
  'code-judge': 'code review judge, composed reviewer, refined dark coat, precise and impartial presence',
};

const actions = [
  { key: 'idle', frames: 6, description: 'standing idle breathing loop, subtle weight shift' },
  { key: 'walk', frames: 8, description: 'side-view walking cycle, natural stride, loopable' },
  { key: 'typing', frames: 6, description: 'standing at a compact floating keyboard or holographic laptop, typing loop' },
  { key: 'talk', frames: 6, description: 'talking gesture loop, one hand moving naturally' },
];

async function loadAgent(name) {
  const raw = await readFile(path.join(agentsDir, `${name}.yaml`), 'utf-8');
  return parse(raw);
}

function baseCharacterSpec(agent) {
  const profile = visualProfiles[agent.name] || 'professional AI teammate, modern workwear, readable silhouette';
  return [
    'Use case: stylized-concept',
    'Asset type: game character asset for an office simulation UI',
    `Primary request:真人比例的半写实 2D 角色，代表 ACEHarness Agent「${agent.title || agent.name}」。`,
    `Subject: ${profile}.`,
    'Style/medium: polished 2D game character art, semi-realistic proportions, clean anime-adjacent rendering, not chibi, not mascot.',
    'Composition/framing: full-body character, front three-quarter view, centered, generous padding, feet visible.',
    'Lighting/mood: soft studio lighting, crisp readable silhouette.',
    'Color palette: tasteful modern SaaS/game palette, role color accents, no brand logos.',
    'Constraints: transparent background if supported; no text; no watermark; no extra objects except small role-relevant handheld props.',
  ].join('\n');
}

function portraitPrompt(agent) {
  return [
    baseCharacterSpec(agent),
    'Output: single full-body character standing pose, high-resolution portrait asset.',
  ].join('\n');
}

function spritePrompt(agent, action) {
  return [
    baseCharacterSpec(agent),
    `Primary animation: ${action.description}.`,
    `Output: one horizontal sprite sheet with exactly ${action.frames} equally sized frames in a single row.`,
    'Each frame must keep the same character identity, outfit, scale, baseline, lighting, and camera angle.',
    'Leave uniform padding inside every frame. No frame numbers, no text, no grid lines, no watermark.',
  ].join('\n');
}

await mkdir(outDir, { recursive: true });

const prompts = [];
const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  outputRoot: publicOutDir,
  agents: {},
};

for (const name of roles) {
  const agent = await loadAgent(name);
  manifest.agents[name] = {
    title: agent.title || name,
    portrait: `${publicOutDir}/${name}/portrait.png`,
    sprites: {},
  };
  prompts.push({
    out: `${name}-portrait.png`,
    prompt: portraitPrompt(agent),
    use_case: 'stylized-concept',
    size: '1024x1536',
    quality: 'high',
  });
  for (const action of actions) {
    manifest.agents[name].sprites[action.key] = {
      src: `${publicOutDir}/${name}/${action.key}.png`,
      frames: action.frames,
      frameWidth: 256,
      frameHeight: 384,
      fps: action.key === 'walk' ? 10 : 8,
    };
    prompts.push({
      out: `${name}-${action.key}.png`,
      prompt: spritePrompt(agent, action),
      use_case: 'stylized-concept',
      size: '1536x1024',
      quality: 'high',
    });
  }
}

await writeFile(path.join(outDir, 'prompts.jsonl'), prompts.map((item) => JSON.stringify(item)).join('\n'), 'utf-8');
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

console.log(`Wrote ${prompts.length} image prompts to ${path.join(outDir, 'prompts.jsonl')}`);
console.log(`Wrote manifest draft to ${path.join(outDir, 'manifest.json')}`);
