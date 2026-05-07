import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(__dirname, '..');
const agentsDir = resolve(projectRoot, 'configs/agents');
const requiredDefaultAgents = [
  'default-supervisor',
  'architect',
  'developer',
  'tester',
  'code-auditor',
  'documentation-writer',
];
const recommendationFallbackAgents = [
  'architect',
  'developer',
  'tester',
  'code-auditor',
  'documentation-writer',
];

interface AgentEntry {
  file: string;
  config: any;
}

async function loadAgentConfigs(): Promise<AgentEntry[]> {
  const files = (await readdir(agentsDir)).filter((file) => file.endsWith('.yaml') || file.endsWith('.yml')).sort();
  expect(files.length, 'configs/agents must contain default agent YAML files').toBeGreaterThan(0);

  return Promise.all(files.map(async (file) => {
    const raw = await readFile(resolve(agentsDir, file), 'utf8');
    let config: any;
    expect(() => {
      config = parse(raw);
    }, `${file} should be valid YAML`).not.toThrow();
    return { file, config };
  }));
}

describe('agent config contract', () => {
  test('all agent YAML configs are parseable and names match filenames', async () => {
    const entries = await loadAgentConfigs();
    const names = new Set<string>();

    for (const { file, config } of entries) {
      const expectedName = basename(file).replace(/\.ya?ml$/, '');
      expect(typeof config?.name, `${file} must declare a string name`).toBe('string');
      expect(config.name, `${file} name must match filename`).toBe(expectedName);
      expect(names.has(config.name), `${config.name} must be unique`).toBe(false);
      names.add(config.name);
    }
  });

  test('default agents required by onboarding and recommendations exist', async () => {
    const entries = await loadAgentConfigs();
    const names = new Set(entries.map((entry) => entry.config.name));

    for (const agent of requiredDefaultAgents) {
      expect(names.has(agent), `missing default agent config: ${agent}`).toBe(true);
    }

    for (const agent of recommendationFallbackAgents) {
      expect(names.has(agent), `recommendation fallback agent must be shippable: ${agent}`).toBe(true);
    }
  });

  test('agent configs satisfy runtime contract fields', async () => {
    const entries = await loadAgentConfigs();

    for (const { file, config } of entries) {
      expect(typeof config.team, `${file} must declare team`).toBe('string');
      expect(config.team.trim(), `${file} team cannot be blank`).not.toBe('');
      expect(Array.isArray(config.capabilities), `${file} must declare capabilities`).toBe(true);
      expect(config.capabilities.length, `${file} must include at least one capability`).toBeGreaterThan(0);
      expect(
        config.capabilities.every((item: unknown) => typeof item === 'string' && item.trim()),
        `${file} capabilities must be non-empty strings`
      ).toBe(true);
      expect(typeof config.systemPrompt, `${file} must declare systemPrompt`).toBe('string');
      expect(config.systemPrompt.trim().length, `${file} systemPrompt must contain usable instructions`).toBeGreaterThan(20);
      expect(
        config.engineModels && typeof config.engineModels === 'object' && !Array.isArray(config.engineModels),
        `${file} must declare engineModels object`
      ).toBe(true);
      expect(typeof config.activeEngine, `${file} must declare activeEngine string`).toBe('string');
    }
  });

  test('default supervisor keeps supervisor-specific routing contract', async () => {
    const entries = await loadAgentConfigs();
    const supervisor = entries.find((entry) => entry.config.name === 'default-supervisor')?.config;

    expect(supervisor, 'default-supervisor config must exist').toBeTruthy();
    expect(supervisor.roleType).toBe('supervisor');
    expect(supervisor.alwaysAvailableForChat).toBe(true);
    expect(supervisor.engineModels).toEqual({});
  });
});
