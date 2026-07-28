import {
  listRuntimeModelsFromSqlite,
  replaceRuntimeModelsFromApiInput,
} from '@/lib/runtime-agent/models/model-routes-api';
import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  try {
    return jsonOk(listRuntimeModelsFromSqlite());
  } catch (error) {
    console.error('Failed to read models:', error);
    return jsonError('Failed to read models', 500);
  }
}

export async function POST(request: Request) {
  try {
    const { models } = await readJsonBody<{ models?: unknown }>(request, {});
    const result = await replaceRuntimeModelsFromApiInput(models);
    return jsonOk({ success: true, ...result });
  } catch (error) {
    console.error('Failed to save models:', error);
    return jsonError('Failed to save models', 500);
  }
}
