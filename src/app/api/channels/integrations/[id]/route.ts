import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { deleteChannelIntegration, getChannelIntegration, saveChannelIntegration } from '@/lib/channel/store';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const integration = await getChannelIntegration(id);
  if (!integration || integration.createdBy !== user.id) {
    return NextResponse.json({ error: '渠道集成不存在' }, { status: 404 });
  }
  return NextResponse.json({ integration });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const existing = await getChannelIntegration(id);
    if (!existing || existing.createdBy !== user.id) {
      return NextResponse.json({ error: '渠道集成不存在' }, { status: 404 });
    }
    const body = await request.json();
    const integration = await saveChannelIntegration({
      ...existing,
      name: typeof body?.name === 'string' ? body.name.trim() || existing.name : existing.name,
      enabled: typeof body?.enabled === 'boolean' ? body.enabled : existing.enabled,
      bindingStrategy: body?.bindingStrategy === 'manual' ? 'manual' : body?.bindingStrategy === 'per-conversation-auto' ? 'per-conversation-auto' : existing.bindingStrategy,
      defaultBinding: body?.defaultBinding && typeof body.defaultBinding === 'object' ? body.defaultBinding : existing.defaultBinding,
      providerConfig: body?.providerConfig && typeof body.providerConfig === 'object' ? body.providerConfig : existing.providerConfig,
    });
    return NextResponse.json({ integration });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '更新渠道集成失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const existing = await getChannelIntegration(id);
  if (!existing || existing.createdBy !== user.id) {
    return NextResponse.json({ error: '渠道集成不存在' }, { status: 404 });
  }
  await deleteChannelIntegration(id);
  return NextResponse.json({ success: true });
}
