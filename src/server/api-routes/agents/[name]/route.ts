import { readFile, writeFile, unlink } from 'fs/promises';
import { parse, stringify } from 'yaml';
import { getRuntimeAgentConfigPath } from '@/lib/run/runtime-configs';
import { formatValidationIssuesForResponse, validateAgentDraft } from '@/lib/core/creator-validation';
import { DEFAULT_SUPERVISOR_NAME } from '@/lib/core/default-supervisor';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(
  request: Request,
  { params }: { params: { name: string } | Promise<{ name: string }> }
) {
  try {
    const name = (await params).name;
    const filepath = await getRuntimeAgentConfigPath(name);
    const content = await readFile(filepath, 'utf-8');
    const agent = parse(content);
    return jsonOk({ agent, raw: content });
  } catch (error: any) {
    return jsonError('读取 Agent 配置失败', 500, errorMessage(error));
  }
}

export async function POST(
  request: Request,
  { params }: { params: { name: string } | Promise<{ name: string }> }
) {
  try {
    const name = (await params).name;
    const body = await readJsonBody<Record<string, any>>(request, {});
    const { agent } = body;
    if (!agent || typeof agent !== 'object' || agent.name !== name) {
      return jsonError('Agent 名称与保存目标不一致', 400);
    }

    const validationResult = validateAgentDraft(name === DEFAULT_SUPERVISOR_NAME
      ? {
          ...agent,
          name: DEFAULT_SUPERVISOR_NAME,
          team: 'black-gold',
          roleType: 'supervisor',
          catalogVisibility: 'system',
        }
      : agent);
    if (!validationResult.ok || !validationResult.normalized) {
      return jsonOk(
        { error: 'Agent 配置验证失败', details: formatValidationIssuesForResponse(validationResult) },
        { status: 400 }
      );
    }

    const filepath = await getRuntimeAgentConfigPath(name);
    const yamlContent = stringify(validationResult.normalized);
    await writeFile(filepath, yamlContent, 'utf-8');

    return jsonOk({ success: true, message: 'Agent 配置已保存' });
  } catch (error: any) {
    return jsonError('保存 Agent 配置失败', 500, errorMessage(error));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { name: string } | Promise<{ name: string }> }
) {
  try {
    const name = (await params).name;
    if (name.includes('..') || name.includes('/')) {
      return jsonError('无效名称', 400);
    }
    if (name === DEFAULT_SUPERVISOR_NAME) {
      return jsonError('default-supervisor 是系统协调角色，不能删除', 400);
    }
    const filepath = await getRuntimeAgentConfigPath(name);
    await unlink(filepath);
    return jsonOk({ success: true, message: 'Agent 配置已删除' });
  } catch (error: any) {
    return jsonError('删除 Agent 配置失败', 500, errorMessage(error));
  }
}
