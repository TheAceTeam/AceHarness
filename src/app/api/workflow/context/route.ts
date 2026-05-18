import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState, saveRunState } from '@/lib/run/state-persistence';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scope, phase, context, runId, configFile } = body;

    if (!scope || !['global', 'phase'].includes(scope)) {
      return NextResponse.json(
        { error: 'scope 必须为 "global" 或 "phase"' },
        { status: 400 }
      );
    }

    if (scope === 'phase' && !phase) {
      return NextResponse.json(
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

    return NextResponse.json({ success: true, message: '上下文已更新' });
  } catch (error: any) {
    return NextResponse.json(
      { error: '设置上下文失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const runId = request.nextUrl.searchParams.get('runId');
    const configFile = request.nextUrl.searchParams.get('configFile');

    // Always read from state.yaml as source of truth
    if (runId) {
      const runState = await loadRunState(runId);
      if (runState) {
        return NextResponse.json({
          globalContext: runState.globalContext || '',
          phaseContexts: runState.phaseContexts || {},
        });
      }
    }

    // Fallback: read from in-memory manager
    const manager = workflowRegistry.getRunningManager(configFile || undefined);
    if (manager) {
      const c = manager.getContexts();
      return NextResponse.json({
        globalContext: c.globalContext || '',
        phaseContexts: c.phaseContexts || {},
      });
    }

    return NextResponse.json({ globalContext: '', phaseContexts: {} });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取上下文失败', message: error.message },
      { status: 500 }
    );
  }
}
