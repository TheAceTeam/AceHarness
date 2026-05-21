import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { prepareAgentChat } from '@/lib/agent/chat-service';
import type { RoleConfig } from '@/lib/core/schemas';

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
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const { name } = await params;
    const body = await request.json();
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
      userContext: {
        id: user.id,
        username: user.username,
        personalDir: user.personalDir,
      },
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Agent 会话初始化失败' },
      { status: 500 }
    );
  }
}
