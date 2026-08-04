import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, test } from 'vitest';
import {
  RETIRED_CATALOG_AGENT_NAMES,
} from '@/lib/agent/catalog';
import { roleConfigSchema } from '@/lib/core/schemas';

const projectRoot = resolve(__dirname, '..');
const agentsDir = resolve(projectRoot, 'configs/agents');
const requiredAgents = [
  'default-supervisor',
  'generalist',
  'researcher',
  'analyst',
  'product-manager',
  'experience-designer',
  'architect',
  'developer',
  'tester',
  'code-hunter',
  'code-judge',
];

interface AgentEntry {
  file: string;
  config: any;
}

async function loadAgentConfigs(): Promise<AgentEntry[]> {
  const files = (await readdir(agentsDir))
    .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
    .sort();

  return Promise.all(files.map(async (file) => ({
    file,
    config: parse(await readFile(resolve(agentsDir, file), 'utf8')),
  })));
}

describe('built-in Agent catalog', () => {
  test('ships parseable canonical identities with schema-valid catalog metadata', async () => {
    const entries = await loadAgentConfigs();
    const names = new Set<string>();

    for (const { file, config } of entries) {
      const expectedName = basename(file).replace(/\.ya?ml$/, '');
      expect(config.name, `${file} name must match filename`).toBe(expectedName);
      expect(names.has(config.name), `${config.name} must be unique`).toBe(false);
      expect(RETIRED_CATALOG_AGENT_NAMES).not.toContain(config.name);
      expect(roleConfigSchema.safeParse(config).success, `${file} must satisfy the Agent schema`).toBe(true);
      expect(Array.isArray(config.expertPacks), `${file} must declare expert packs`).toBe(true);
      expect(Array.isArray(config.taskModes), `${file} must declare task modes`).toBe(true);
      names.add(config.name);
    }

    for (const name of requiredAgents) {
      expect(names.has(name), `missing built-in Agent: ${name}`).toBe(true);
    }
  });

  test('keeps one protected system Supervisor and no task-state personas', async () => {
    const entries = await loadAgentConfigs();
    const supervisors = entries.filter(({ config }) => config.roleType === 'supervisor');

    expect(supervisors).toHaveLength(1);
    expect(supervisors[0]?.config).toMatchObject({
      name: 'default-supervisor',
      team: 'black-gold',
      catalogVisibility: 'system',
      alwaysAvailableForChat: true,
    });
    expect(RETIRED_CATALOG_AGENT_NAMES).toEqual(expect.arrayContaining([
      'fix-architect',
      'fix-developer',
      'fix-breaker',
      'fix-hunter',
      'fix-judge',
      'fix-reviewer',
    ]));
  });
});
