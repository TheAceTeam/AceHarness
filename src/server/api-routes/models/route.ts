import fs from 'fs/promises';
import { parse, stringify } from 'yaml';
import { getModelOptions, clearModelsCache, normalizeModelOptions, type ModelOption } from '@/lib/core/models';
import { getRuntimeModelsConfigPath } from '@/lib/run/runtime-configs';
import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  try {
    const models = await getModelOptions();
    return jsonOk({ models });
  } catch (error) {
    console.error('Failed to read models:', error);
    return jsonError('Failed to read models', 500);
  }
}

export async function POST(request: Request) {
  try {
    const { models } = await readJsonBody<{ models?: unknown }>(request, {});

    // Read current config
    let config: { models: ModelOption[] };
    try {
      const content = await fs.readFile(await getRuntimeModelsConfigPath(), 'utf-8');
      config = parse(content) || { models: [] };
    } catch {
      config = { models: [] };
    }

    // Update models
    config.models = normalizeModelOptions(models);

    // Write back to YAML
    const yamlContent = stringify(config, { lineWidth: 0 });
    await fs.writeFile(await getRuntimeModelsConfigPath(), yamlContent, 'utf-8');

    // Clear cache so next read gets fresh data
    clearModelsCache();

    return jsonOk({ success: true });
  } catch (error) {
    console.error('Failed to save models:', error);
    return jsonError('Failed to save models', 500);
  }
}
