import { NextRequest, NextResponse } from 'next/server';
import { loadChatSettings, saveChatSettings, discoverSkills } from '@/lib/chat/settings';

export async function GET() {
  const settings = await loadChatSettings();
  const discovered = await discoverSkills();
  return NextResponse.json({ ...settings, discoveredSkills: discovered });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    await saveChatSettings(body);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
