import { NextRequest, NextResponse } from 'next/server';
import { loadChatSettings, saveChatSettings, discoverSkills } from '@/lib/chat/settings';
import { loadMcpRegistry } from '@/lib/mcp/registry';

export async function GET() {
  const settings = await loadChatSettings();
  const discovered = await discoverSkills();
  const discoveredMcpServers = await loadMcpRegistry();
  return NextResponse.json({ ...settings, discoveredSkills: discovered, discoveredMcpServers });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const current = await loadChatSettings();
    await saveChatSettings({
      skills: body?.skills && typeof body.skills === 'object'
        ? body.skills
        : current.skills,
      mcpServers: body?.mcpServers && typeof body.mcpServers === 'object'
        ? body.mcpServers
        : current.mcpServers,
      workingDirectory: typeof body?.workingDirectory === 'string'
        ? body.workingDirectory
        : current.workingDirectory,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
