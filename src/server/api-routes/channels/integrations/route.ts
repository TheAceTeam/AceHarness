import { requireAuth } from '@/lib/auth/middleware';
import { createChannelIntegration, listChannelIntegrations } from '@/lib/channel/store';
import { getChannelProviderPreset } from '@/lib/channel/providers';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  const integrations = (await listChannelIntegrations()).filter((item) => item.createdBy === user.id);
  return jsonOk({ integrations });
}

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const provider = getChannelProviderPreset(String(body?.provider || ''));
    if (!provider) {
      return jsonError('不支持的渠道 provider', 400);
    }
    const integration = await createChannelIntegration({
      name: String(body?.name || provider.name).trim() || provider.name,
      provider: provider.id,
      createdBy: user.id,
      capabilities: provider.capabilities,
      bindingStrategy: body?.bindingStrategy === 'manual' ? 'manual' : 'per-conversation-auto',
      defaultBinding: body?.defaultBinding && typeof body.defaultBinding === 'object' ? body.defaultBinding : null,
      providerConfig: body?.providerConfig && typeof body.providerConfig === 'object' ? body.providerConfig : {},
      enabled: body?.enabled !== false,
    });
    return jsonOk({ integration });
  } catch (error) {
    return jsonError(errorMessage(error) || '创建渠道集成失败', 500);
  }
}
