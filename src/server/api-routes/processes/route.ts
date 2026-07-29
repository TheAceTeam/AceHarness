import { processManager } from '@/lib/core/process-manager';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  try {
    const processes = processManager.getAllProcesses();
    const stats = processManager.getStats();

    return jsonOk({
      processes,
      stats,
    });
  } catch (error: any) {
    return jsonOk(
      { error: '获取进程列表失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { killed, pids, registeredKilled, registeredProcessIds } = await processManager.killAllSystem({
      registeredProcessScope: 'all',
    });
    const totalKilled = killed + registeredKilled;

    return jsonOk({
      success: true,
      message: totalKilled > 0
        ? `已终止所有进程，清理了 ${totalKilled} 个进程`
        : '所有进程已终止',
      killedSystemPids: pids,
      killedProcessIds: registeredProcessIds,
    });
  } catch (error: any) {
    return jsonOk(
      { error: '终止进程失败', message: error.message },
      { status: 500 }
    );
  }
}
