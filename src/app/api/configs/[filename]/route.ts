import { NextRequest, NextResponse } from 'next/server';
import { readFile, readdir, writeFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { getConfigMeta, deleteConfigMeta } from '@/lib/config-metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeAgentsDirPath, getRuntimeConfigsDirPath, getRuntimeWorkflowConfigPath, markConfigDeleted, unmarkConfigDeleted } from '@/lib/runtime-configs';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/creator-validation';

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('无效文件名');
  }
  return normalized;
}

async function canAccessWorkflow(filename: string, userId: string, role: 'admin' | 'user') {
  const meta = await getConfigMeta(filename, 'workflow');
  if (!meta) return true;
  if (meta.visibility === 'public') return true;
  if (role === 'admin') return true;
  return !meta.createdBy || meta.createdBy === userId;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const filename = (await params).filename;
    if (!(await canAccessWorkflow(filename, auth.id, auth.role))) {
      return NextResponse.json({ error: '无权限访问该工作流' }, { status: 403 });
    }

    const filepath = await getRuntimeWorkflowConfigPath(filename);
    const content = await readFile(filepath, 'utf-8');
    const config = parse(content);
    const validation = validateWorkflowDraft(config);

    // Load agents from configs/agents/*.yaml
    const agents: any[] = [];
    try {
      const agentsDir = await getRuntimeAgentsDirPath();
      const files = await readdir(agentsDir);
      for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
        try {
          const agentContent = await readFile(resolve(agentsDir, file), 'utf-8');
          const agent = parse(agentContent);
          if (agent?.name) agents.push(agent);
        } catch { /* skip */ }
      }
    } catch { /* agents dir may not exist */ }

    return NextResponse.json({
      config,
      raw: content,
      agents,
      validation: {
        ...formatValidationIssuesForResponse(validation),
        normalized: validation.normalized,
      },
    });
  } catch (error: any) {
    // List available configs to help AI self-correct
    let available: string[] = [];
    try {
      await ensureRuntimeConfigsSeeded();
      const configsDir = await getRuntimeConfigsDirPath();
      const files = await readdir(configsDir);
      available = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch { /* ignore */ }
    const filename = (await params).filename;
    return NextResponse.json(
      {
        error: '读取配置失败',
        message: `文件 ${filename} 不存在或无法读取`,
        availableConfigs: available,
      },
      { status: 404 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const filename = (await params).filename;
    if (!(await canAccessWorkflow(filename, auth.id, auth.role))) {
      return NextResponse.json({ error: '无权限修改该工作流' }, { status: 403 });
    }

    const body = await request.json();
    const { config } = body;

    // Strip roles before saving — agents are managed separately
    const { roles, ...configWithoutRoles } = config;

    // Validate config (roles is optional now)
    const validationResult = validateWorkflowDraft(configWithoutRoles);
    if (!validationResult.ok || !validationResult.normalized) {
      return NextResponse.json(
        {
          error: '配置验证失败',
          details: formatValidationIssuesForResponse(validationResult),
        },
        { status: 400 }
      );
    }

    const filepath = await getRuntimeWorkflowConfigPath(filename);
    const yamlContent = stringify(validationResult.normalized);
    await writeFile(filepath, yamlContent, 'utf-8');
    const configsDir = await getRuntimeConfigsDirPath();
    await unmarkConfigDeleted(configsDir, filename);

    return NextResponse.json({ success: true, message: '配置已保存' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '保存配置失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const filename = (await params).filename;
    normalizeConfigFilename(filename);
    if (!(await canAccessWorkflow(filename, auth.id, auth.role))) {
      return NextResponse.json({ error: '无权限删除该工作流' }, { status: 403 });
    }
    const filepath = await getRuntimeWorkflowConfigPath(filename);
    await unlink(filepath);
    const configsDir = await getRuntimeConfigsDirPath();
    await markConfigDeleted(configsDir, filename);
    await deleteConfigMeta(filename, 'workflow');
    return NextResponse.json({ success: true, message: '配置已删除' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '删除配置失败', message: error.message },
      { status: 500 }
    );
  }
}
