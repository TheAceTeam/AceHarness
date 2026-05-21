import { NextRequest, NextResponse } from 'next/server';
import {
  deleteAgoraGuestConfig,
  getAgoraGuestConfig,
  saveAgoraGuestConfig,
} from '@/lib/agora/guest-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const guest = await getAgoraGuestConfig(id);
    if (!guest) return NextResponse.json({ error: '嘉宾不存在' }, { status: 404 });
    return NextResponse.json({ guest });
  } catch (error: any) {
    return NextResponse.json(
      { error: '读取议场嘉宾失败', message: error?.message || '未知错误' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
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
    return NextResponse.json({ success: true, guest });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '保存议场嘉宾失败' },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await deleteAgoraGuestConfig(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '删除议场嘉宾失败' },
      { status: 400 },
    );
  }
}
