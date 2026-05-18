import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/core/process-manager';

export async function GET(request: NextRequest) {
  try {
    const processes = processManager.getAllProcesses();
    const stats = processManager.getStats();

    return NextResponse.json({
      processes,
      stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取进程列表失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { killed, pids } = await processManager.killAllSystem();

    return NextResponse.json({
      success: true,
      message: killed > 0
        ? `已终止所有进程，清理了 ${killed} 个系统残留进程`
        : '所有进程已终止',
      killedSystemPids: pids,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '终止进程失败', message: error.message },
      { status: 500 }
    );
  }
}
