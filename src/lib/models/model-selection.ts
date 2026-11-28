import type { ModelOption } from '@/lib/core/models';
import { parseProviderModel } from './model-config';

export function splitModelEffort(value: string) {
  const parsed = parseProviderModel(value);
  const effort = parsed.configOptions.effort ?? parsed.configOptions.reasoning_effort;
  return { ...parsed, effort: typeof effort === 'string' ? effort : '' };
}

export function withModelEffort(value: string, effort: string): string {
  const parsed = splitModelEffort(value);
  const options = { ...parsed.configOptions };
  delete options.effort;
  delete options.reasoning_effort;
  if (effort) options.effort = effort;
  const entries = Object.entries(options);
  return parsed.providerModel + (entries.length ? `[${entries.map(([key, value]) => `${key}=${value}`).join(',')}]` : '');
}

/** Collapse older imported effort variants without invalidating saved selections. */
export function groupModelEfforts(models: ModelOption[]): ModelOption[] {
  const groups = new Map<string, ModelOption>();
  for (const model of models) {
    const parsed = splitModelEffort(model.value);
    const baseValue = withModelEffort(model.value, '');
    const current = groups.get(baseValue);
    const efforts = [...new Set([...(current?.efforts || []), ...(model.efforts || []), ...(parsed.effort ? [parsed.effort] : [])])];
    const base = !parsed.effort ? model : current || model;
    groups.set(baseValue, { ...base, value: baseValue, label: base.baseName || base.label, efforts });
  }
  return [...groups.values()];
}
