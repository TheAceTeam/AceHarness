import { NextRequest, NextResponse } from 'next/server';
import {
  createDeterministicAvatarConfig,
  resolveAgentAvatarSrc,
} from '@/lib/agent-personas';

function buildSeed(input: {
  displayName: string;
  team: string;
  mission?: string;
  style?: string;
  variant?: string;
}) {
  return [
    input.displayName.trim(),
    input.team.trim(),
    (input.mission || '').trim().slice(0, 48),
    (input.style || '').trim().slice(0, 48),
    input.variant || Date.now().toString(36),
  ]
    .filter(Boolean)
    .join('::');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const displayName = String(body.displayName || '').trim();
    const team = String(body.team || 'blue').trim() as any;
    const mission = String(body.mission || '').trim();
    const style = String(body.style || '').trim();
    const variant = String(body.variant || '').trim();
    const roleType = team === 'black-gold' ? 'supervisor' : 'normal';

    if (!displayName) {
      return NextResponse.json({ error: 'displayName 不能为空' }, { status: 400 });
    }

    const avatar = createDeterministicAvatarConfig(buildSeed({ displayName, team, mission, style, variant }), {
      team,
      roleType,
    });

    return NextResponse.json({
      avatar: {
        ...avatar,
        prompt: `${displayName} / ${team} / ${mission || '通用协作'} / ${style || '专业、直接、可靠'}`,
        generatedAt: new Date().toISOString(),
      },
      previewUrl: resolveAgentAvatarSrc(avatar, displayName, { team, roleType }),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '生成 Agent 头像失败' },
      { status: 500 },
    );
  }
}
