import { invalidateChatSettingsCache } from '@/lib/chat/settings';
import { loadMcpRegistry, saveMcpRegistry } from '@/lib/mcp/registry';
import { errorMessage, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  const servers = await loadMcpRegistry();
  return jsonOk({ servers });
}

export async function PUT(request: Request) {
  try {
    const body = await readJsonBody<{ servers?: unknown[] }>(request, {});
    const nextServers = Array.isArray(body?.servers) ? body.servers : [];
    const servers = await saveMcpRegistry(nextServers);
    invalidateChatSettingsCache();
    return jsonOk({ success: true, servers });
  } catch (error: any) {
    return jsonOk({ error: errorMessage(error) || '保存 MCP 配置失败' }, { status: 500 });
  }
}
