/**
 * Node.js-only instrumentation implementations
 * This file is only imported when NEXT_RUNTIME === 'nodejs'
 */

export async function runNodejsInstrumentation() {
  const { existsSync, mkdirSync } = await import('fs');
  const { join } = await import('path');
  const { getEngineConfigPath, getWorkspaceAgentConfigDir, getWorkspaceRoot } = await import('./app-paths');

  const workspaceRoot = getWorkspaceRoot();

  let engineConfigDir = '.agents';
  try {
    const engineJson = getEngineConfigPath();
    if (existsSync(engineJson)) {
      const { readFileSync } = await import('fs');
      const config = JSON.parse(readFileSync(engineJson, 'utf-8'));
      if (config.engine) engineConfigDir = getWorkspaceAgentConfigDir(config.engine);
    }
  } catch {
    // Use the default engine config directory.
  }

  const configDir = join(workspaceRoot, engineConfigDir);
  try {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
      console.log(`[ACEHarness] Created ${engineConfigDir}/`);
    }
  } catch (error) {
    console.error(`[ACEHarness] Failed to setup ${engineConfigDir}:`, error);
  }

  try {
    const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
    const recoverer = new StateMachineWorkflowManager();
    await recoverer.recoverFromCrash();
    await restoreDurableHumanApprovalWaits();
  } catch (error) {
    console.error('[ACEHarness] Workflow recovery failed:', error);
  }

  try {
    const { ensureChannelEventBridgeRegistered } = await import('@/lib/channel/delivery');
    ensureChannelEventBridgeRegistered();
  } catch (error) {
    console.error('[ACEHarness] Channel event bridge setup failed:', error);
  }

  try {
    const { scheduleWeChatOfficialBridgeRestore } = await import('@/lib/channel/wechat/official-service');
    scheduleWeChatOfficialBridgeRestore();
  } catch (error) {
    console.error('[ACEHarness] WeChat bridge restore setup failed:', error);
  }

  try {
    const { ensureSchedulerInitialized } = await import('@/server/api-route-runtime/scheduler-runtime');
    await ensureSchedulerInitialized();
  } catch (error) {
    console.error('[ACEHarness] Scheduler restore failed:', error);
  }
}

/**
 * Reattach the in-memory waiter for persisted human approvals after a Node
 * service restart.  The run snapshot is authoritative; only the lightweight
 * waiter is recreated.  In particular, this lets external GitCode gate
 * observations continue without replaying completed workflow steps.
 */
export async function restoreDurableHumanApprovalWaits(): Promise<void> {
  const { findActiveRuns } = await import('@/lib/run/state-persistence');
  const { workflowRegistry } = await import('@/lib/workflow/registry');
  const activeRuns = await findActiveRuns();

  for (const runState of activeRuns) {
    if (runState.mode !== 'state-machine'
      || runState.currentState !== '__human_approval__'
      || !(runState.pendingHumanQuestionId || runState.pendingCheckpoint)) {
      continue;
    }

    try {
      const manager = await workflowRegistry.getManagerByRunId(runState.runId);
      if (!manager || manager.getStatus().status === 'running') continue;
      void manager.resumeInBackground(runState.runId).catch((error) => {
        console.error(`[ACEHarness] Failed to restore approval observer for ${runState.runId}:`, error);
      });
      console.log(`[ACEHarness] Restoring durable approval observer for ${runState.runId}`);
    } catch (error) {
      console.error(`[ACEHarness] Failed to prepare approval observer for ${runState.runId}:`, error);
    }
  }
}
