/**
 * Model catalog IDs may carry the DSH provider that owns the model:
 * `provider/model-id`. The provider-qualified form is deliberately kept in
 * the catalog ID so endpoint filters remain API endpoint metadata.
 */
export type ProviderQualifiedModelId = {
  providerId?: string;
  modelId: string;
};

export function parseProviderQualifiedModelId(value: string): ProviderQualifiedModelId {
  const normalized = String(value || '').trim();
  const separator = normalized.indexOf('/');
  if (separator <= 0 || separator === normalized.length - 1) {
    return { modelId: normalized };
  }

  const providerId = normalized.slice(0, separator).trim();
  const modelId = normalized.slice(separator + 1).trim();
  if (!providerId || !modelId) return { modelId: normalized };
  return { providerId, modelId };
}

export function qualifyModelId(providerId: string | undefined, modelId: string): string {
  const provider = String(providerId || '').trim();
  const model = String(modelId || '').trim();
  return provider && model ? `${provider}/${model}` : model;
}
