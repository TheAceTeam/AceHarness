/** Parse the existing model[key=value,...] configuration format. */
export function parseProviderModel(value: string): { providerModel: string; configOptions: Record<string, unknown> } {
  const match = value.match(/^(.+?)\[(.*)]$/);
  if (!match || !match[2].includes('=')) return { providerModel: value, configOptions: {} };
  const [, providerModel, rawOptions] = match;
  const configOptions: Record<string, unknown> = {};
  for (const part of rawOptions.split(',').map(item => item.trim()).filter(Boolean)) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = rawKey?.trim();
    const value = rawValueParts.join('=').trim();
    if (!key) continue;
    if (value === 'true') configOptions[key] = true;
    else if (value === 'false') configOptions[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) configOptions[key] = Number(value);
    else configOptions[key] = value;
  }
  return { providerModel, configOptions };
}
