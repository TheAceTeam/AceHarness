import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { feedback, configFile } = body;

    if (!feedback?.trim()) {
      return NextResponse.json(
        { error: '迭代意见不能为空' },
        { status: 400 }
      );
    }

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!manager) {
      return NextResponse.json(
        { error: '没有正在运行的工作流' },
        { status: 400 }
      );
    }

    manager.requestIteration(feedback);

    return NextResponse.json({
      success: true,
      message: '已请求继续迭代',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '请求迭代失败', message: error.message },
      { status: 500 }
    );
  }
}
