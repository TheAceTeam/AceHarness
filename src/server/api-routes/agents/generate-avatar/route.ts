import {
  createDeterministicAvatarConfig,
  resolveAgentAvatarSrc,
} from '@/lib/agent/personas';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

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

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const displayName = String(body.displayName || '').trim();
    const team = String(body.team || 'red').trim() as any;
    const mission = String(body.mission || '').trim();
    const style = String(body.style || '').trim();
    const variant = String(body.variant || '').trim();
    const roleType = team === 'black-gold' ? 'supervisor' : 'normal';

    if (!displayName) {
      return jsonError('displayName 不能为空', 400);
    }

    const avatar = createDeterministicAvatarConfig(buildSeed({ displayName, team, mission, style, variant }), {
      team,
      roleType,
    });

    return jsonOk({
      avatar: {
        ...avatar,
        prompt: `${displayName} / ${team} / ${mission || '通用协作'} / ${style || '专业、直接、可靠'}`,
        generatedAt: new Date().toISOString(),
      },
      previewUrl: resolveAgentAvatarSrc(avatar, displayName, { team, roleType }),
    });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '生成 Agent 头像失败', 500);
  }
}
