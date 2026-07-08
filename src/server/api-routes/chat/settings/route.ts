import { invalidateChatSettingsCache, loadChatSettings, saveChatSettings, discoverSkills } from '@/lib/chat/settings';
import { loadMcpRegistry } from '@/lib/mcp/registry';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  invalidateChatSettingsCache();
  const settings = await loadChatSettings();
  const discovered = await discoverSkills();
  const discoveredMcpServers = await loadMcpRegistry();
  return jsonOk({ ...settings, discoveredSkills: discovered, discoveredMcpServers });
}

export async function PUT(request: Request) {
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
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
      capabilitySkills: body?.capabilitySkills && typeof body.capabilitySkills === 'object'
        ? body.capabilitySkills
        : current.capabilitySkills,
    });
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error), 500);
  }
}
