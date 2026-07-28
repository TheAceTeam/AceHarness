import {
  deleteAgoraGuestConfig,
  getAgoraGuestConfig,
  saveAgoraGuestConfig,
} from '@/lib/agora/guest-store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const guest = await getAgoraGuestConfig(id);
    if (!guest) return jsonError('嘉宾不存在', 404);
    return jsonOk({ guest });
  } catch (error: any) {
    return jsonError('读取议场嘉宾失败', 500, errorMessage(error));
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await readJsonBody<Record<string, any>>(request, {});
    const guest = await saveAgoraGuestConfig({
      id,
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

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await deleteAgoraGuestConfig(id);
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '删除议场嘉宾失败', 400);
  }
}
