import { NextResponse } from 'next/server';
import { buildDashboardSystemPrompt } from '@/lib/chat/system-prompt';
import { loadChatSettings } from '@/lib/chat/settings';

export async function GET() {
  try {
    const settings = await loadChatSettings();
    const enabled = Object.entries(settings.skills || {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    const prompt = await buildDashboardSystemPrompt(enabled);
    return NextResponse.json({
      prompt,
      enabledSkills: enabled,
      skills: settings.skills,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
