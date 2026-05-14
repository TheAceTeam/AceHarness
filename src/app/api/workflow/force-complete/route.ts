import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { configFile } = body;

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!manager) {
      return NextResponse.json(
        { error: '当前没有运行中的工作流' },
        { status: 400 }
      );
    }

    const result = await manager.forceCompleteStep();
    if (!result) {
      return NextResponse.json(
        { error: '当前没有正在运行的步骤' },
        { status: 400 }
      );
    }
    return NextResponse.json({
      success: true,
      step: result.step,
      outputLength: result.output.length,
      message: `步骤 "${result.step}" 已强制完成`,
    });
  } catch (error: any) {
    console.error('[force-complete] error:', error);
    return NextResponse.json(
      { error: '强制完成失败', message: error.message },
      { status: 500 }
    );
  }
}
