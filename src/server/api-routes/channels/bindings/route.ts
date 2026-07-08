import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth/middleware';
import { getChannelIntegration, listChannelBindings, listChannelIntegrations, saveChannelBinding } from '@/lib/channel/store';

export async function GET(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  const integrationId = requestUrl(request).searchParams.get('integrationId');
  const allowedIntegrationIds = integrationId
    ? new Set((await Promise.all([getChannelIntegration(integrationId)])).filter((item): item is NonNullable<typeof item> => Boolean(item) && item!.createdBy === user.id).map((item) => item.id))
    : new Set((await listChannelIntegrations()).filter((item) => item.createdBy === user.id).map((item) => item.id));
  const all = await listChannelBindings();
  const bindings = all.filter((item) => allowedIntegrationIds.has(item.integrationId));
  return jsonOk({ bindings });
}

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const integrationId = String(body?.integrationId || '');
    const integration = await getChannelIntegration(integrationId);
    if (!integration || integration.createdBy !== user.id) {
      return jsonError('渠道集成不存在', 404);
    }
    if (!body?.externalConversationId) {
      return jsonError('缺少 externalConversationId', 400);
    }
    const binding = await saveChannelBinding({
      id: typeof body?.id === 'string' ? body.id : `binding-${randomUUID()}`,
      integrationId,
      bindingType: body?.bindingType === 'agent-chat' ? 'agent-chat' : 'workflow-run',
      createdBy: user.id,
      createdAt: Date.now(),
      externalConversationId: String(body.externalConversationId),
      externalConversationName: typeof body?.externalConversationName === 'string' ? body.externalConversationName : undefined,
      externalUserId: typeof body?.externalUserId === 'string' ? body.externalUserId : undefined,
      runId: typeof body?.runId === 'string' ? body.runId : undefined,
      configFile: typeof body?.configFile === 'string' ? body.configFile : undefined,
      frontendSessionId: typeof body?.frontendSessionId === 'string' ? body.frontendSessionId : undefined,
      agentName: typeof body?.agentName === 'string' ? body.agentName : undefined,
      agentSessionId: typeof body?.agentSessionId === 'string' ? body.agentSessionId : undefined,
      workflowMode: body?.workflowMode === 'feedback-only' ? 'feedback-only' : 'full-control',
      metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
    });
    return jsonOk({ binding });
  } catch (error) {
    return jsonError(errorMessage(error) || '保存 binding 失败', 500);
  }
}
