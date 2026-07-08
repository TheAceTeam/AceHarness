import { requireAuth } from '@/lib/auth/middleware';
import { deleteChannelIntegration, getChannelIntegration, saveChannelIntegration } from '@/lib/channel/store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const integration = await getChannelIntegration(id);
  if (!integration || integration.createdBy !== user.id) {
    return jsonError('渠道集成不存在', 404);
  }
  return jsonOk({ integration });
}

export async function PUT(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  try {
    const { id } = await params;
    const existing = await getChannelIntegration(id);
    if (!existing || existing.createdBy !== user.id) {
      return jsonError('渠道集成不存在', 404);
    }
    const body = await readJsonBody<Record<string, any>>(request, {});
    const integration = await saveChannelIntegration({
      ...existing,
      name: typeof body?.name === 'string' ? body.name.trim() || existing.name : existing.name,
      enabled: typeof body?.enabled === 'boolean' ? body.enabled : existing.enabled,
      bindingStrategy: body?.bindingStrategy === 'manual' ? 'manual' : body?.bindingStrategy === 'per-conversation-auto' ? 'per-conversation-auto' : existing.bindingStrategy,
      defaultBinding: body?.defaultBinding && typeof body.defaultBinding === 'object' ? body.defaultBinding : existing.defaultBinding,
      providerConfig: body?.providerConfig && typeof body.providerConfig === 'object' ? body.providerConfig : existing.providerConfig,
    });
    return jsonOk({ integration });
  } catch (error) {
    return jsonError(errorMessage(error) || '更新渠道集成失败', 500);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const existing = await getChannelIntegration(id);
  if (!existing || existing.createdBy !== user.id) {
    return jsonError('渠道集成不存在', 404);
  }
  await deleteChannelIntegration(id);
  return jsonOk({ success: true });
}
