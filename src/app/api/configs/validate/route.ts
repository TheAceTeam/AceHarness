import { readFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/creator-validation';
import { getRuntimeWorkflowConfigPath } from '@/lib/runtime-configs';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    let config = body?.config;
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';

    if (!config && filename) {
      const filepath = await getRuntimeWorkflowConfigPath(filename);
      config = parse(await readFile(filepath, 'utf-8'));
    }

    if (!config || typeof config !== 'object') {
      return NextResponse.json(
        { error: '缺少 workflow 配置对象或 filename' },
        { status: 400 }
      );
    }

    const validation = validateWorkflowDraft(config);
    return NextResponse.json({
      success: true,
      validation: {
        ...formatValidationIssuesForResponse(validation),
        normalized: validation.normalized,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '工作流校验失败', message: error?.message || '未知错误' },
      { status: 500 }
    );
  }
}
