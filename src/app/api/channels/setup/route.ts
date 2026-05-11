import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { createChannelIntegration, type ChannelDefaultBinding } from '@/lib/channel-store';
import { getChannelProviderPreset } from '@/lib/channel-providers';

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const provider = getChannelProviderPreset(String(body?.provider || ''));
    if (!provider) {
      return NextResponse.json({ error: '不支持的渠道 provider' }, { status: 400 });
    }

    const defaultBinding = body?.defaultBinding && typeof body.defaultBinding === 'object'
      ? body.defaultBinding as ChannelDefaultBinding
      : undefined;

    const integration = await createChannelIntegration({
      name: String(body?.name || provider.name).trim() || provider.name,
      provider: provider.id,
      createdBy: user.id,
      capabilities: provider.capabilities,
      bindingStrategy: body?.bindingStrategy === 'manual' ? 'manual' : 'per-conversation-auto',
      defaultBinding,
      providerConfig: body?.providerConfig && typeof body.providerConfig === 'object' ? body.providerConfig : {},
      enabled: body?.enabled !== false,
    });

    return NextResponse.json({
      integration,
      preset: provider,
      onboarding: {
        webhookUrl: integration.webhookPath,
        secret: integration.secret,
        nextSteps: provider.setupGuide,
        samplePayload: {
          secret: integration.secret,
          message: {
            conversationId: 'demo-room',
            conversationName: 'Demo Room',
            userId: 'u-demo',
            userName: 'Demo User',
            text: '/status',
          },
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '创建渠道集成失败' }, { status: 500 });
  }
}
