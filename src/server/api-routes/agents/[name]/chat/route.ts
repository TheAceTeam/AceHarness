import { requireAuth } from '@/lib/auth/middleware';
import { executeAgentChat } from '@/lib/agent/chat-service';
import type { RoleConfig } from '@/lib/core/schemas';
import { recordModelProbeObservation } from '@/lib/models/probes';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

function parseTemporaryRoleConfig(body: any): RoleConfig | null {
  const raw = body?.temporaryRoleConfig;
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const systemPrompt = typeof raw.systemPrompt === 'string' ? raw.systemPrompt.trim() : '';
  if (!name || !systemPrompt) return null;
  return {
    name,
    team: raw.team === 'red' || raw.team === 'blue' || raw.team === 'judge' || raw.team === 'black-gold' ? raw.team : 'judge',
    roleType: raw.roleType === 'supervisor' ? 'supervisor' : 'normal',
    title: typeof raw.title === 'string' ? raw.title : undefined,
    persona: typeof raw.persona === 'string' ? raw.persona : undefined,
    greeting: typeof raw.greeting === 'string' ? raw.greeting : undefined,
    rarity: 'common',
    engineModels: raw.engineModels && typeof raw.engineModels === 'object' ? raw.engineModels : {},
    activeEngine: typeof raw.activeEngine === 'string' ? raw.activeEngine : '',
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.filter((item: unknown): item is string => typeof item === 'string') : ['multi-agent-chat'],
    systemPrompt,
    constraints: Array.isArray(raw.constraints) ? raw.constraints.filter((item: unknown): item is string => typeof item === 'string') : ['不调用工具', '不修改文件'],
    allowedTools: [],
    category: typeof raw.category === 'string' ? raw.category : 'temporary-lab',
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((item: unknown): item is string => typeof item === 'string')
      : ['temporary'],
    alwaysAvailableForChat: false,
  } as RoleConfig;
}

export async function POST(
  request: Request,
  { params }: { params: { name: string } | Promise<{ name: string }> }
) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const { name } = await params;
    const body = await readJsonBody<Record<string, any>>(request, {});
    const temporaryRoleConfig = parseTemporaryRoleConfig(body);
    const executeStartedAt = Date.now();
    const result = await executeAgentChat({
      agentName: name,
      message: String(body?.message || ''),
      mode: body?.mode === 'workflow-chat' ? 'workflow-chat' : 'standalone-chat',
      sessionId: typeof body?.runtimeSessionId === 'string'
        ? body.runtimeSessionId
        : (typeof body?.sessionId === 'string' ? body.sessionId : null),
      frontendSessionId: typeof body?.frontendSessionId === 'string' ? body.frontendSessionId : null,
      workingDirectory: typeof body?.workingDirectory === 'string' ? body.workingDirectory : undefined,
      workflowContext: body?.workflowContext && typeof body.workflowContext === 'object'
        ? body.workflowContext as Record<string, any>
        : null,
      temporaryRoleConfig,
      requestedMcpServers: body?.requestedMcpServers ?? body?.mcpServers,
      userContext: {
        id: user.id,
        username: user.username,
        personalDir: user.personalDir,
      },
    });
    void recordModelProbeObservation({
      engine: result.engine || '',
      model: result.model || '',
      success: !result.isError,
      source: 'agent-chat',
      responseLatencyMs: Date.now() - executeStartedAt,
      totalDurationMs: Date.now() - executeStartedAt,
      outputPreview: result.output || result.rawOutput || '',
      error: result.isError ? (result.error || 'Agent 对话失败') : undefined,
    }).catch(() => {});
    if (!result.ok && !result.output) {
      return jsonOk(
        { error: result.error || 'Agent 对话失败', sessionId: result.sessionId || null },
        { status: 500 }
      );
    }
    return jsonOk(result);
  } catch (error: any) {
    return jsonError(errorMessage(error) || 'Agent 对话失败', 500);
  }
}
