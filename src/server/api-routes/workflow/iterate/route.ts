import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { feedback, configFile } = body;

    if (!feedback?.trim()) {
      return jsonOk(
        { error: '迭代意见不能为空' },
        { status: 400 }
      );
    }

    const manager = workflowRegistry.getRunningManager(configFile);
    if (!manager) {
      return jsonOk(
        { error: '没有正在运行的工作流' },
        { status: 400 }
      );
    }

    manager.requestIteration(feedback);

    return jsonOk({
      success: true,
      message: '已请求继续迭代',
    });
  } catch (error: any) {
    return jsonOk(
      { error: '请求迭代失败', message: error.message },
      { status: 500 }
    );
  }
}
