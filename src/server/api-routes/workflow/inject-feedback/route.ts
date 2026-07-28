import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { message, interrupt, configFile, clientId, runId } = body;

    if (!message?.trim()) {
      return jsonOk(
        { error: '反馈内容不能为空' },
        { status: 400 }
      );
    }

    // Must specify an explicit target to avoid sending to the wrong workflow.
    if (!configFile && !runId) {
      return jsonOk(
        { error: '必须指定 configFile 或 runId 参数' },
        { status: 400 }
      );
    }

    const manager = typeof runId === 'string' && runId.trim()
      ? await workflowRegistry.getManagerByRunId(runId.trim())
      : workflowRegistry.getRunningManager(configFile);
    if (!manager) {
      return jsonOk(
        { error: '当前没有运行中的工作流' },
        { status: 409 }
      );
    }

    if (interrupt) {
      const ok = manager.interruptWithFeedback(message.trim(), { id: typeof clientId === 'string' ? clientId : undefined });
      return jsonOk({
        success: true,
        interrupted: ok,
        message: ok ? '已打断当前执行，反馈将立即处理' : '打断失败，反馈已排队等待',
      });
    }

    const interrupted = manager.injectLiveFeedback(message.trim(), { id: typeof clientId === 'string' ? clientId : undefined });

    return jsonOk({
      success: true,
      interrupted,
      message: interrupted ? '反馈已发送，AI 正在接入' : '反馈已排队等待处理',
    });
  } catch (error: any) {
    return jsonOk(
      { error: '注入反馈失败', message: error.message },
      { status: 500 }
    );
  }
}
