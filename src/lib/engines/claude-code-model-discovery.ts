import { buildEnvObject, loadEnvVars } from '@/lib/core/env-manager';
import { getModelOptions, type ModelOption } from '@/lib/core/models';

export interface DiscoveredClaudeCodeModel {
  modelId: string;
  name: string;
  source: 'alias' | 'api' | 'config';
  recommended?: boolean;
}

interface AnthropicModelsApiResponse {
  data?: Array<{
    id?: string;
    display_name?: string;
    name?: string;
  }>;
}

const CLAUDE_CODE_MODEL_ALIASES: Array<{
  modelId: string;
  name: string;
  recommended?: boolean;
}> = [
  { modelId: 'default', name: 'Auto (default)', recommended: true },
  { modelId: 'best', name: 'Best', recommended: true },
  { modelId: 'sonnet', name: 'Claude Sonnet', recommended: true },
  { modelId: 'opus', name: 'Claude Opus' },
  { modelId: 'haiku', name: 'Claude Haiku' },
  { modelId: 'opusplan', name: 'Claude Opus Plan' },
];

function isClaudeCodeModelId(modelId: string): boolean {
  return /^(default|best|sonnet|opus|haiku|opusplan|claude-)/.test(modelId);
}

function mergeIntoMap(
  map: Map<string, DiscoveredClaudeCodeModel>,
  model: DiscoveredClaudeCodeModel,
) {
  const existing = map.get(model.modelId);
  if (!existing) {
    map.set(model.modelId, model);
    return;
  }

  const sourcePriority = { alias: 0, api: 1, config: 2 };
  const preferred = sourcePriority[model.source] < sourcePriority[existing.source] ? model : existing;

  map.set(model.modelId, {
    ...existing,
    ...preferred,
    recommended: existing.recommended || model.recommended,
  });
}

async function loadAnthropicApiKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const vars = await loadEnvVars({ scope: 'system' });
    const env = buildEnvObject(vars);
    return env.ANTHROPIC_API_KEY || '';
  } catch {
    return '';
  }
}

async function discoverFromAnthropicApi(): Promise<DiscoveredClaudeCodeModel[]> {
  const apiKey = await loadAnthropicApiKey();
  if (!apiKey) return [];

  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Anthropic Models API returned ${response.status}`);
  }

  const data = await response.json() as AnthropicModelsApiResponse;
  const models = (data.data || [])
    .map((item): DiscoveredClaudeCodeModel | null => {
      const modelId = String(item.id || '').trim();
      if (!modelId || !modelId.startsWith('claude-')) return null;
      return {
        modelId,
        name: String(item.display_name || item.name || modelId),
        source: 'api' as const,
      };
    })
    .filter((item): item is DiscoveredClaudeCodeModel => item !== null);

  return models;
}

function discoverFromConfig(models: ModelOption[]): DiscoveredClaudeCodeModel[] {
  return models
    .filter((model) => model.engines?.includes('claude-code') && isClaudeCodeModelId(model.value))
    .map((model) => ({
      modelId: model.value,
      name: model.label || model.value,
      source: 'config' as const,
    }));
}

function sortDiscoveredModels(models: DiscoveredClaudeCodeModel[]): DiscoveredClaudeCodeModel[] {
  const sourcePriority = { alias: 0, api: 1, config: 2 };
  return [...models].sort((a, b) => {
    if (Boolean(b.recommended) !== Boolean(a.recommended)) {
      return Number(Boolean(b.recommended)) - Number(Boolean(a.recommended));
    }
    if (sourcePriority[a.source] !== sourcePriority[b.source]) {
      return sourcePriority[a.source] - sourcePriority[b.source];
    }
    return a.modelId.localeCompare(b.modelId);
  });
}

export async function discoverClaudeCodeModels(): Promise<{
  models: DiscoveredClaudeCodeModel[];
  usedAnthropicApi: boolean;
  fallback: 'aliases-only' | 'aliases+config' | 'aliases+api+config';
}> {
  const configuredModels = await getModelOptions();
  const discovered = new Map<string, DiscoveredClaudeCodeModel>();

  for (const alias of CLAUDE_CODE_MODEL_ALIASES) {
    mergeIntoMap(discovered, { ...alias, source: 'alias' });
  }

  let apiModels: DiscoveredClaudeCodeModel[] = [];
  let usedAnthropicApi = false;
  try {
    apiModels = await discoverFromAnthropicApi();
    usedAnthropicApi = apiModels.length > 0;
  } catch {
    apiModels = [];
  }

  for (const model of apiModels) {
    mergeIntoMap(discovered, model);
  }

  for (const model of discoverFromConfig(configuredModels)) {
    mergeIntoMap(discovered, model);
  }

  return {
    models: sortDiscoveredModels(Array.from(discovered.values())),
    usedAnthropicApi,
    fallback: usedAnthropicApi ? 'aliases+api+config' : (configuredModels.length > 0 ? 'aliases+config' : 'aliases-only'),
  };
}
