import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { message, runId } = body;

    if (!message?.trim()) {
      return jsonOk(
        { error: '反馈内容不能为空' },
        { status: 400 }
      );
    }

    if (typeof runId === 'string' && runId.trim()) {
      const manager = await workflowRegistry.getManagerByRunId(runId.trim());
      const recalled = manager?.recallLiveFeedback(message.trim());
      if (recalled) {
        return jsonOk({ success: true, message: '反馈已撤回' });
      }
      return jsonOk(
        { error: '该反馈已被处理或不存在' },
        { status: 404 }
      );
    }

    // Try all running managers
    const running = workflowRegistry.getRunningManagers();
    for (const { manager } of running) {
      const recalled = manager.recallLiveFeedback(message.trim());
      if (recalled) {
        return jsonOk({ success: true, message: '反馈已撤回' });
      }
    }

    return jsonOk(
      { error: '该反馈已被处理或不存在' },
      { status: 404 }
    );
  } catch (error: any) {
    return jsonOk(
      { error: '撤回反馈失败', message: error.message },
      { status: 500 }
    );
  }
}
