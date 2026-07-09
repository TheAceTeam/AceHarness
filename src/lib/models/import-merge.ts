import type { ModelOption } from '@/lib/core/models';

export type DetectedModelImportItem = {
  modelId: string;
  label?: string;
  costMultiplier?: number;
  endpoints?: string[];
  selected?: boolean;
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

    const existing = mergedMap.get(modelId);
    if (existing) {
      mergedMap.set(modelId, {
        ...existing,
        label: detected.label || existing.label,
        costMultiplier: detected.costMultiplier ?? existing.costMultiplier ?? 1,
        endpoints: uniqueStrings([...(existing.endpoints || []), ...(detected.endpoints || [])]),
        engines: uniqueStrings([...(existing.engines || []), engine]),
      });
      continue;
    }

    mergedMap.set(modelId, {
      value: modelId,
      label: detected.label || modelId,
      costMultiplier: detected.costMultiplier ?? 1,
      endpoints: uniqueStrings(detected.endpoints || []),
      engines: engine ? [engine] : [],
    });
  }

  return Array.from(mergedMap.values());
}
