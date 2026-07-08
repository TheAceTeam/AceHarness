import { requestUrl, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState, saveRunState } from '@/lib/run/state-persistence';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { scope, phase, context, runId, configFile } = body;

    if (!scope || !['global', 'phase'].includes(scope)) {
      return jsonOk(
        { error: 'scope 必须为 "global" 或 "phase"' },
        { status: 400 }
      );
    }

    if (scope === 'phase' && !phase) {
      return jsonOk(
        { error: '阶段上下文需要指定 phase 名称' },
        { status: 400 }
      );
    }

    // Update in-memory state for running manager
    let currentRunId = runId;
    const manager = workflowRegistry.getRunningManager(configFile);
    if (manager) {
      manager.setContext(scope, context || '', phase);
      currentRunId = currentRunId || manager.getStatus().runId;
    }

    // Always persist to state.yaml
    if (currentRunId) {
      const runState = await loadRunState(currentRunId);
      if (runState) {
        if (scope === 'global') {
          runState.globalContext = context || '';
        } else if (phase) {
          runState.phaseContexts = runState.phaseContexts || {};
          runState.phaseContexts[phase] = context || '';
        }
        await saveRunState(runState);
      }
    }

    return jsonOk({ success: true, message: '上下文已更新' });
  } catch (error: any) {
    return jsonOk(
      { error: '设置上下文失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const runId = requestUrl(request).searchParams.get('runId');
    const configFile = requestUrl(request).searchParams.get('configFile');

    // Always read from state.yaml as source of truth
    if (runId) {
      const runState = await loadRunState(runId);
      if (runState) {
        return jsonOk({
          globalContext: runState.globalContext || '',
          phaseContexts: runState.phaseContexts || {},
        });
      }
    }

    // Fallback: read from in-memory manager
    const manager = workflowRegistry.getRunningManager(configFile || undefined);
    if (manager) {
      const c = manager.getContexts();
      return jsonOk({
        globalContext: c.globalContext || '',
        phaseContexts: c.phaseContexts || {},
      });
    }

    return jsonOk({ globalContext: '', phaseContexts: {} });
  } catch (error: any) {
    return jsonOk(
      { error: '获取上下文失败', message: error.message },
      { status: 500 }
    );
  }
}
