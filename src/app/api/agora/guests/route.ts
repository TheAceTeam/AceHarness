import { NextRequest, NextResponse } from 'next/server';
import {
  listAgoraGuestConfigs,
  listAgoraGuestPresets,
  saveAgoraGuestConfig,
} from '@/lib/agora/guest-store';

export async function GET() {
  try {
    const [guests, presets] = await Promise.all([
      listAgoraGuestConfigs(),
      listAgoraGuestPresets(),
    ]);
    return NextResponse.json({ guests, presets });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取议场嘉宾失败', message: error?.message || '未知错误' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
    return NextResponse.json({ success: true, guest });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '保存议场嘉宾失败' },
      { status: 400 },
    );
  }
}
