import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, interrupt, configFile } = body;

    if (!message?.trim()) {
      return NextResponse.json(
        { error: '反馈内容不能为空' },
        { status: 400 }
      );
    }

    // Must specify configFile to avoid sending to wrong workflow
    if (!configFile) {
      return NextResponse.json(
        { error: '必须指定 configFile 参数' },
        { status: 400 }
      );
    }

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!manager) {
      return NextResponse.json(
        { error: '当前没有运行中的工作流' },
        { status: 409 }
      );
    }

    if (interrupt) {
      const ok = manager.interruptWithFeedback(message.trim());
      return NextResponse.json({
        success: true,
        interrupted: ok,
        message: ok ? '已打断当前执行，反馈将立即处理' : '打断失败，反馈已排队等待',
      });
    }

    manager.injectLiveFeedback(message.trim());

    return NextResponse.json({
      success: true,
      message: '反馈已注入',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '注入反馈失败', message: error.message },
      { status: 500 }
    );
  }
}
