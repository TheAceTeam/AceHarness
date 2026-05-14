import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { executeAgentChat } from '@/lib/agent/chat-service';
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
    category: 'temporary-lab',
    tags: ['temporary', 'werewolf-lab'],
    alwaysAvailableForChat: false,
  } as RoleConfig;
}

function isTemporaryWerewolfChat(body: any): boolean {
  return body?.workflowContext?.temporaryLab === 'werewolf'
    || body?.temporaryRoleConfig?.category === 'temporary-lab'
    || (Array.isArray(body?.temporaryRoleConfig?.tags) && body.temporaryRoleConfig.tags.includes('werewolf-lab'));
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
    const temporaryRoleConfig = parseTemporaryRoleConfig(body);
    if (isTemporaryWerewolfChat(body) && !temporaryRoleConfig) {
      return NextResponse.json(
        { error: '临时狼人杀 Agent 配置缺失或无效，已拒绝回退到业务 Agent 配置。' },
        { status: 400 }
      );
    }
    const result = await executeAgentChat({
      agentName: name,
      message: String(body?.message || ''),
      mode: body?.mode === 'workflow-chat' ? 'workflow-chat' : 'standalone-chat',
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : null,
      workingDirectory: typeof body?.workingDirectory === 'string' ? body.workingDirectory : undefined,
      workflowContext: body?.workflowContext && typeof body.workflowContext === 'object'
        ? body.workflowContext as Record<string, any>
        : null,
      temporaryRoleConfig,
      userContext: {
        id: user.id,
        username: user.username,
        personalDir: user.personalDir,
      },
    });
    if (!result.ok && !result.output) {
      return NextResponse.json(
        { error: result.error || 'Agent 对话失败', sessionId: result.sessionId || null },
        { status: 500 }
      );
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Agent 对话失败' },
      { status: 500 }
    );
  }
}
