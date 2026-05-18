import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, configFile } = body;

    if (!message?.trim()) {
      return NextResponse.json(
        { error: '反馈内容不能为空' },
        { status: 400 }
      );
    }

    // Try all running managers
    const running = workflowRegistry.getRunningManagers();
    for (const { manager } of running) {
      const recalled = manager.recallLiveFeedback(message.trim());
      if (recalled) {
        return NextResponse.json({ success: true, message: '反馈已撤回' });
      }
    }

    return NextResponse.json(
      { error: '该反馈已被处理或不存在' },
      { status: 404 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: '撤回反馈失败', message: error.message },
      { status: 500 }
    );
  }
}
