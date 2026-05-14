import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { configFile } = body;

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!manager) {
      return NextResponse.json(
        { error: '没有正在运行的工作流' },
        { status: 400 }
      );
    }

    manager.approve();

    return NextResponse.json({
      success: true,
      message: '检查点已批准',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '批准检查点失败', message: error.message },
      { status: 500 }
    );
  }
}
