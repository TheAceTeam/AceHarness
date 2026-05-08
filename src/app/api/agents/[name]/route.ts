import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, unlink } from 'fs/promises';
import { parse, stringify } from 'yaml';
import { getRuntimeAgentConfigPath } from '@/lib/runtime-configs';
import { formatValidationIssuesForResponse, validateAgentDraft } from '@/lib/creator-validation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const name = (await params).name;
    const filepath = await getRuntimeAgentConfigPath(name);
    const content = await readFile(filepath, 'utf-8');
    const agent = parse(content);
    return NextResponse.json({ agent, raw: content });
  } catch (error: any) {
    return NextResponse.json(
      { error: '读取 Agent 配置失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const name = (await params).name;
    const body = await request.json();
    const { agent } = body;

    const validationResult = validateAgentDraft(agent);
    if (!validationResult.ok || !validationResult.normalized) {
      return NextResponse.json(
        { error: 'Agent 配置验证失败', details: formatValidationIssuesForResponse(validationResult) },
        { status: 400 }
      );
    }

    const filepath = await getRuntimeAgentConfigPath(name);
    const yamlContent = stringify(validationResult.normalized);
    await writeFile(filepath, yamlContent, 'utf-8');

    return NextResponse.json({ success: true, message: 'Agent 配置已保存' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '保存 Agent 配置失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const name = (await params).name;
    if (name.includes('..') || name.includes('/')) {
      return NextResponse.json({ error: '无效名称' }, { status: 400 });
    }
    const filepath = await getRuntimeAgentConfigPath(name);
    await unlink(filepath);
    return NextResponse.json({ success: true, message: 'Agent 配置已删除' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '删除 Agent 配置失败', message: error.message },
      { status: 500 }
    );
  }
}
