import type { ModelOption } from '@/lib/core/models';

export type DetectedModelImportItem = {
  modelId: string;
  label?: string;
  costMultiplier?: number;
  endpoints?: string[];
  selected?: boolean;
  efforts?: string[];
};

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function mergeDetectedModelsForImport(input: {
  models: ModelOption[];
  detectedModels: DetectedModelImportItem[];
  engine: string;
}): ModelOption[] {
  const engine = String(input.engine || '').trim();
  const mergedMap = new Map(input.models.map((model) => [model.value, { ...model }]));

  for (const detected of input.detectedModels) {
    if (detected.selected === false) continue;
    const modelId = String(detected.modelId || '').trim();
    if (!modelId) continue;

    const endpoints = detected.endpoints ?? (engine === 'codex' ? ['openai'] : engine === 'claude' ? ['anthropic'] : []);
    const existing = mergedMap.get(modelId);
    if (existing) {
      mergedMap.set(modelId, {
        ...existing,
        label: detected.label || existing.label,
        costMultiplier: detected.costMultiplier ?? existing.costMultiplier ?? 1,
        endpoints: uniqueStrings([...(existing.endpoints || []), ...endpoints]),
        engines: uniqueStrings([...(existing.engines || []), engine]),
        ...(detected.efforts ? { efforts: uniqueStrings(detected.efforts) } : {}),
      });
      continue;
    }

    mergedMap.set(modelId, {
      value: modelId,
      label: detected.label || modelId,
      costMultiplier: detected.costMultiplier ?? 1,
      endpoints: uniqueStrings(endpoints),
      engines: engine ? [engine] : [],
      ...(detected.efforts ? { efforts: uniqueStrings(detected.efforts) } : {}),
    });
  }

  return Array.from(mergedMap.values());
}
