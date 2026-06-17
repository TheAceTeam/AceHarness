import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { parse, stringify } from 'yaml';
import { agentWorkspaceProfileSchema, roleConfigSchema } from '@/lib/core/schemas';
import { getRuntimeAgentConfigPath } from '@/lib/run/runtime-configs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const name = (await params).name;
    const body = await request.json();
    const profileInput = body?.workspaceProfile ?? body;
    const profileResult = agentWorkspaceProfileSchema.safeParse(profileInput);
    if (!profileResult.success) {
      return NextResponse.json(
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
      return NextResponse.json(
        { error: 'Agent 配置验证失败', details: agentResult.error.issues },
        { status: 400 }
      );
    }

    await writeFile(filepath, stringify(nextAgent), 'utf-8');
    return NextResponse.json({
      success: true,
      workspaceProfile: nextAgent.workspaceProfile,
      agent: nextAgent,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '保存协作空间配置失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export const POST = PATCH;
