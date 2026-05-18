import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/core/process-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const process = processManager.getProcess(id);

    if (!process) {
      return NextResponse.json(
        { error: '进程不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json(process);
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取进程信息失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const success = processManager.killProcess(id);

    if (!success) {
      return NextResponse.json(
        { error: '进程不存在或已终止' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '进程已终止',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '终止进程失败', message: error.message },
      { status: 500 }
    );
  }
}
