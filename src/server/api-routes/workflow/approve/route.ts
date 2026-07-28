import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { configFile } = body;

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!manager) {
      return jsonOk(
        { error: '没有正在运行的工作流' },
        { status: 400 }
      );
    }

    manager.approve();

    return jsonOk({
      success: true,
      message: '检查点已批准',
    });
  } catch (error: any) {
    return jsonOk(
      { error: '批准检查点失败', message: error.message },
      { status: 500 }
    );
  }
}
