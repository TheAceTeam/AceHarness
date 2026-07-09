import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { isLocalAgentIconPath } from '@/lib/runtime-agent/agent-icons';
import {
  BUILTIN_AGENT_DEFINITIONS,
  getBuiltinAgentDefinitions,
  mergeAgentRuntimeState,
} from '@/lib/runtime-agent/agent-registry';

const REQUIRED_VISIBLE_AGENT_IDS = [
  'codex',
  'claude',
  'opencode',
  'cursor',
  'kiro',
  'trae',
  'nga',
  'codegenie',
  'cangjie-magic',
] as const;

describe('runtime agent registry', () => {
  test('registers required core and verified agents with local icon assets', () => {
    const definitionsById = new Map(BUILTIN_AGENT_DEFINITIONS.map((agent) => [agent.id, agent]));

    for (const agentId of REQUIRED_VISIBLE_AGENT_IDS) {
      const definition = definitionsById.get(agentId);

      expect(definition, `${agentId} must be registered`).toBeTruthy();
      expect(['core', 'verified']).toContain(definition?.tier);
      expect(definition?.iconPath, `${agentId} icon must be local`).toMatch(/^\/engines\/.+\.(svg|png)$/);
      expect(
        existsSync(path.join(process.cwd(), 'public', definition?.iconPath ?? '')),
        `${agentId} icon asset must exist`,
      ).toBe(true);
    }
  });

  test('keeps nga and codegenie as independent opencode-compatible agents', () => {
    const definitionsById = new Map(BUILTIN_AGENT_DEFINITIONS.map((agent) => [agent.id, agent]));
    const nga = definitionsById.get('nga');
    const codegenie = definitionsById.get('codegenie');

    expect(nga?.id).toBe('nga');
    expect(nga?.family).toBe('opencode-compatible');
    expect(nga?.command).toBe('ngagent');
    expect(nga?.args).toEqual(['acp']);
    expect(nga?.fallbackCommands).toEqual(['nga']);

    expect(codegenie?.id).toBe('codegenie');
    expect(codegenie?.family).toBe('opencode-compatible');
    expect(codegenie?.command).toBe('codegenie');
    expect(codegenie?.args).toEqual(['acp']);
  });

  test('does not use emoji icon fallbacks for experimental agents', () => {
    const experimentalAgents = getBuiltinAgentDefinitions(['experimental']);

    expect(experimentalAgents.length).toBeGreaterThan(0);
    for (const definition of experimentalAgents) {
      expect(isLocalAgentIconPath(definition.iconPath), `${definition.id} icon must be a local asset path`).toBe(true);
      expect(definition.iconPath).toBe('/engines/code-agent.svg');
      expect(existsSync(path.join(process.cwd(), 'public', definition.iconPath))).toBe(true);
    }
  });

  test('merges builtin definitions with sqlite runtime state dto', () => {
    const [codex, claude] = mergeAgentRuntimeState([
      {
        agentId: 'codex',
        enabled: false,
        availability: {
          status: 'available',
          checkedAt: '2026-07-09T00:00:00.000Z',
        },
        envReadiness: {
          status: 'ready',
        },
        capabilityProbe: {
          shell: false,
        },
      },
      {
        agentId: 'claude',
        hidden: true,
        override: {
          displayName: 'Claude Code',
          fallbackCommands: ['claude-code'],
        },
      },
    ]);

    expect(codex.definition.id).toBe('codex');
    expect(codex.runtimeState.enabled).toBe(false);
    expect(codex.runtimeState.availability).toMatchObject({
      status: 'available',
      source: 'probe',
    });
    expect(codex.definition.capabilities.shell).toBe(false);
    expect(codex.sources.capabilities).toBe('probe');

    expect(claude.definition.id).toBe('claude');
    expect(claude.definition.displayName).toBe('Claude Code');
    expect(claude.definition.runtime).toBe('acpx');
    expect(claude.definition.tier).toBe('core');
    expect(claude.runtimeState.hidden).toBe(true);
    expect(claude.sources.override).toBe('override');
  });

  test('adds discovered sqlite-only agents as hidden generic-provider entries', () => {
    const entries = mergeAgentRuntimeState([
      {
        agentId: 'custom-acpx',
        discovery: {
          commandPath: 'custom-agent',
          version: '1.0.0',
        },
      },
    ]);
    const custom = entries.find((entry) => entry.definition.id === 'custom-acpx');

    expect(custom?.definition.tier).toBe('hidden');
    expect(custom?.runtimeState.hidden).toBe(true);
    expect(custom?.definition.iconPath).toBe('/engines/code-agent.svg');
    expect(custom?.sources.discovery).toBe('discovery');
  });
});
