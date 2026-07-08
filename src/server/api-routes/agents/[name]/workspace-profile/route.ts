import { readFile, writeFile } from 'fs/promises';
import { parse, stringify } from 'yaml';
import { agentWorkspaceProfileSchema, roleConfigSchema } from '@/lib/core/schemas';
import { getRuntimeAgentConfigPath } from '@/lib/run/runtime-configs';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function PATCH(
  request: Request,
  { params }: { params: { name: string } | Promise<{ name: string }> }
) {
  try {
    const name = (await params).name;
    const body = await readJsonBody<Record<string, any>>(request, {});
    const profileInput = body?.workspaceProfile ?? body;
    const profileResult = agentWorkspaceProfileSchema.safeParse(profileInput);
    if (!profileResult.success) {
      return jsonOk(
        { error: '协作空间配置验证失败', details: profileResult.error.issues },
        { status: 400 }
      );
    }

    const filepath = await getRuntimeAgentConfigPath(name);
    const current = parse(await readFile(filepath, 'utf-8'));
    const nextAgent = {
      ...current,
      workspaceProfile: profileResult.data,
    };
    const agentResult = roleConfigSchema.safeParse(nextAgent);
    if (!agentResult.success) {
      return jsonOk(
        { error: 'Agent 配置验证失败', details: agentResult.error.issues },
        { status: 400 }
      );
    }

    await writeFile(filepath, stringify(nextAgent), 'utf-8');
    return jsonOk({
      success: true,
      workspaceProfile: nextAgent.workspaceProfile,
      agent: nextAgent,
    });
  } catch (error: any) {
    return jsonError('保存协作空间配置失败', 500, errorMessage(error));
  }
}

export const POST = PATCH;
