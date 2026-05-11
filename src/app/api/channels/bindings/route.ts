import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth-middleware';
import { getChannelIntegration, listChannelBindings, listChannelIntegrations, saveChannelBinding } from '@/lib/channel-store';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  const integrationId = request.nextUrl.searchParams.get('integrationId');
  const allowedIntegrationIds = integrationId
    ? new Set((await Promise.all([getChannelIntegration(integrationId)])).filter((item): item is NonNullable<typeof item> => Boolean(item) && item!.createdBy === user.id).map((item) => item.id))
    : new Set((await listChannelIntegrations()).filter((item) => item.createdBy === user.id).map((item) => item.id));
  const all = await listChannelBindings();
  const bindings = all.filter((item) => allowedIntegrationIds.has(item.integrationId));
  return NextResponse.json({ bindings });
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  try {
    const body = await request.json();
    const integrationId = String(body?.integrationId || '');
    const integration = await getChannelIntegration(integrationId);
    if (!integration || integration.createdBy !== user.id) {
      return NextResponse.json({ error: '渠道集成不存在' }, { status: 404 });
    }
    if (!body?.externalConversationId) {
      return NextResponse.json({ error: '缺少 externalConversationId' }, { status: 400 });
    }
    const binding = await saveChannelBinding({
      id: typeof body?.id === 'string' ? body.id : `binding-${randomUUID()}`,
      integrationId,
      bindingType: body?.bindingType === 'roundtable' || body?.bindingType === 'agent-chat' ? body.bindingType : 'workflow-run',
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
      roundtableId: typeof body?.roundtableId === 'string' ? body.roundtableId : undefined,
      roundtableParticipants: Array.isArray(body?.roundtableParticipants)
        ? body.roundtableParticipants.filter((item: unknown): item is string => typeof item === 'string')
        : undefined,
      roundtableSummarizer: typeof body?.roundtableSummarizer === 'string' ? body.roundtableSummarizer : undefined,
      metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
    });
    return NextResponse.json({ binding });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '保存 binding 失败' }, { status: 500 });
  }
}
