import { processManager } from '@/lib/core/process-manager';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const process = processManager.getProcess(id);

    if (!process) {
      return jsonOk(
        { error: '进程不存在' },
        { status: 404 }
      );
    }

    return jsonOk(process);
  } catch (error: any) {
    return jsonOk(
      { error: '获取进程信息失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const success = processManager.killProcess(id);

    if (!success) {
      return jsonOk(
        { error: '进程不存在或已终止' },
        { status: 404 }
      );
    }

    return jsonOk({
      success: true,
      message: '进程已终止',
    });
  } catch (error: any) {
    return jsonOk(
      { error: '终止进程失败', message: error.message },
      { status: 500 }
    );
  }
}
