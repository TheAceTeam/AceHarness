/**
 * Node.js-only instrumentation implementations
 * This file is only imported when NEXT_RUNTIME === 'nodejs'
 */

export async function runNodejsInstrumentation() {
  const { existsSync, mkdirSync } = await import('fs');
  const { join } = await import('path');
  const { getEngineConfigDir } = await import('./engines/engine-config');
  const { getEngineConfigPath, getWorkspaceRoot } = await import('./app-paths');
  const { ensureDirectoryLinkSync } = await import('./directory-links');
  const { getRuntimeSkillsDirPath } = await import('./runtime-skills');

  const workspaceRoot = getWorkspaceRoot();
  const skillsDir = await getRuntimeSkillsDirPath();

  let engineConfigDir = '.claude';
  try {
    const engineJson = getEngineConfigPath();
    if (existsSync(engineJson)) {
      const { readFileSync } = await import('fs');
      const config = JSON.parse(readFileSync(engineJson, 'utf-8'));
      if (config.engine) engineConfigDir = getEngineConfigDir(config.engine);
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

    const skillsLink = join(configDir, 'skills');
    if (existsSync(skillsDir) && ensureDirectoryLinkSync(skillsDir, skillsLink) === 'created') {
      console.log(`[ACEHarness] Linked ${engineConfigDir}/skills -> ${skillsDir}`);
    }
  } catch (error) {
    console.error(`[ACEHarness] Failed to setup ${engineConfigDir}:`, error);
  }

  try {
    const { WorkflowManager } = await import('./workflow-manager');
    const recoverer = new WorkflowManager();
    await recoverer.recoverFromCrash();
  } catch (error) {
    console.error('[ACEHarness] Workflow recovery failed:', error);
  }

  try {
    const { ensureChannelEventBridgeRegistered } = await import('./channel-delivery');
    ensureChannelEventBridgeRegistered();
  } catch (error) {
    console.error('[ACEHarness] Channel event bridge setup failed:', error);
  }
}
