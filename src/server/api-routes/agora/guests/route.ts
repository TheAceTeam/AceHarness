import {
  listAgoraGuestConfigs,
  listAgoraGuestPresets,
  saveAgoraGuestConfig,
} from '@/lib/agora/guest-store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  try {
    const [guests, presets] = await Promise.all([
      listAgoraGuestConfigs(),
      listAgoraGuestPresets(),
    ]);
    return jsonOk({ guests, presets });
  } catch (error: any) {
    return jsonError('获取议场嘉宾失败', 500, errorMessage(error));
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const guest = await saveAgoraGuestConfig({
      id: typeof body?.id === 'string' ? body.id : undefined,
      displayName: String(body?.displayName || ''),
      sourceType: body?.sourceType === 'custom' ? 'custom' : 'preset',
      sourceAgent: typeof body?.sourceAgent === 'string' ? body.sourceAgent : undefined,
      presetId: typeof body?.presetId === 'string' ? body.presetId : undefined,
      personaPrompt: typeof body?.personaPrompt === 'string' ? body.personaPrompt : undefined,
      engine: typeof body?.engine === 'string' ? body.engine : undefined,
      model: typeof body?.model === 'string' ? body.model : undefined,
    });
    return jsonOk({ success: true, guest });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '保存议场嘉宾失败', 400);
  }
}
