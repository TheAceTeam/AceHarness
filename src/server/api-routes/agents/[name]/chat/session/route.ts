import { requireAuth } from '@/lib/auth/middleware';
import { prepareAgentChat } from '@/lib/agent/chat-service';
import type { RoleConfig } from '@/lib/core/schemas';
import type { RequestedMcpServersInput } from '@/lib/chat/request-options';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function readStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : fallback;
}

function readRequestedMcpServers(value: unknown): RequestedMcpServersInput {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
}

function parseTemporaryRoleConfig(body: Record<string, unknown>): RoleConfig | null {
  const raw = body?.temporaryRoleConfig;
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const systemPrompt = typeof raw.systemPrompt === 'string' ? raw.systemPrompt.trim() : '';
  if (!name || !systemPrompt) return null;
  const roleConfig: RoleConfig = {
    name,
    team: raw.team === 'red' || raw.team === 'blue' || raw.team === 'judge' || raw.team === 'black-gold' ? raw.team : 'judge',
    roleType: raw.roleType === 'supervisor' ? 'supervisor' : 'normal',
    title: typeof raw.title === 'string' ? raw.title : undefined,
    persona: typeof raw.persona === 'string' ? raw.persona : undefined,
    greeting: typeof raw.greeting === 'string' ? raw.greeting : undefined,
    rarity: 'common',
    engineModels: readStringRecord(raw.engineModels),
    activeEngine: typeof raw.activeEngine === 'string' ? raw.activeEngine : '',
    capabilities: readStringList(raw.capabilities, ['multi-agent-chat']),
    systemPrompt,
    constraints: readStringList(raw.constraints, ['不调用工具', '不修改文件']),
    allowedTools: [],
    category: typeof raw.category === 'string' ? raw.category : 'temporary-lab',
    tags: readStringList(raw.tags, ['temporary']),
    expertPacks: [],
    catalogVisibility: 'default',
    taskModes: [],
    alwaysAvailableForChat: false,
  };
  return roleConfig;
}

export async function POST(
  request: Request,
  { params }: { params: { name: string } | Promise<{ name: string }> }
) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const { name } = await params;
    const body = await readJsonBody<Record<string, unknown>>(request, {});
    const result = await prepareAgentChat({
      agentName: name,
      message: '',
      mode: body?.mode === 'workflow-chat' ? 'workflow-chat' : 'standalone-chat',
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : null,
      workingDirectory: typeof body?.workingDirectory === 'string' ? body.workingDirectory : undefined,
      workflowContext: body?.workflowContext && typeof body.workflowContext === 'object'
        ? body.workflowContext as Record<string, any>
        : null,
      temporaryRoleConfig: parseTemporaryRoleConfig(body),
      requestedMcpServers: readRequestedMcpServers(body.requestedMcpServers ?? body.mcpServers),
      userContext: {
        id: user.id,
        username: user.username,
        personalDir: user.personalDir,
      },
    });
    return jsonOk(result);
  } catch (error: any) {
    return jsonError(errorMessage(error) || 'Agent 会话初始化失败', 500);
  }
}
