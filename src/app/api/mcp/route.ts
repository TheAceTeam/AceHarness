import { NextRequest, NextResponse } from 'next/server';
import { invalidateChatSettingsCache } from '@/lib/chat/settings';
import { loadMcpRegistry, saveMcpRegistry } from '@/lib/mcp/registry';

export async function GET() {
  const servers = await loadMcpRegistry();
  return NextResponse.json({ servers });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const nextServers = Array.isArray(body?.servers) ? body.servers : [];
    const servers = await saveMcpRegistry(nextServers);
    invalidateChatSettingsCache();
    return NextResponse.json({ success: true, servers });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '保存 MCP 配置失败' }, { status: 500 });
  }
}
