// 模型配置 - 从 configs/models.yaml 读取
import fs from 'fs/promises';
import { parse } from 'yaml';
import { getRuntimeModelsConfigPath } from '@/lib/run/runtime-configs';
import { modelEnginesSupportEngine, normalizeModelEngineIds } from '@/lib/models/engine-compatibility';

export interface ModelOption {
  value: string;
  label: string;
  costMultiplier: number;
  endpoints: string[];
  engines?: string[];
  contextWindow?: number;
  status?: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
}

interface ModelsConfig {
  models: ModelOption[];
}

let cachedModels: ModelOption[] | null = null;

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeModelEngines(engines: unknown): string[] {
  return normalizeModelEngineIds(engines);
}

export function normalizeModelOption(model: ModelOption): ModelOption {
  return {
    ...model,
    endpoints: uniqueStrings(model.endpoints),
    engines: normalizeModelEngines(model.engines),
  };
}

export function normalizeModelOptions(models: unknown): ModelOption[] {
  if (!Array.isArray(models)) return [];
  return models.map((model) => normalizeModelOption(model as ModelOption));
}

export function modelSupportsEngine(
  model: Pick<ModelOption, 'engines'>,
  engine?: string | null,
): boolean {
  return modelEnginesSupportEngine(model.engines, engine);
}

async function loadModels(): Promise<ModelOption[]> {
  if (cachedModels) return cachedModels;

  const configPath = await getRuntimeModelsConfigPath();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = parse(content) as ModelsConfig;
    cachedModels = normalizeModelOptions(config.models);
    return cachedModels;
  } catch {
    // Fallback to empty array if file not found
    cachedModels = [];
    return cachedModels;
  }
}

// 同步版本（使用缓存），用于服务端渲染等同步场景
export function getModelOptionsSync(): ModelOption[] {
  return cachedModels || [];
}

// 异步加载（推荐）
export async function getModelOptions(): Promise<ModelOption[]> {
  return loadModels();
}

// 清除缓存（用于保存后重新加载）
export function clearModelsCache(): void {
  cachedModels = null;
}

// 获取模型显示名称
export async function getModelLabel(value: string): Promise<string> {
  const models = await loadModels();
  return models.find(m => m.value === value)?.label || value;
}

// 获取模型费用倍率
export async function getModelCostMultiplier(value: string): Promise<number> {
  const models = await loadModels();
  return models.find(m => m.value === value)?.costMultiplier || 1;
}

// 同步版本（需要先调用过异步版本）
export function getModelLabelSync(value: string): string {
  const models = cachedModels || [];
  return models.find(m => m.value === value)?.label || value;
}

export function getModelCostMultiplierSync(value: string): number {
  const models = cachedModels || [];
  return models.find(m => m.value === value)?.costMultiplier || 1;
}
