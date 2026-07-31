import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';

export async function assertScheduleWorkflowConfig(configFile: string) {
  if (!configFile || typeof configFile !== 'string') {
    throw new Error('缺少工作流配置文件');
  }

  const configPath = await getRuntimeWorkflowConfigPath(configFile);
  const config = parse(await readFile(configPath, 'utf-8')) as any;
  const hasWorkflowRoot = Boolean(config?.workflow && typeof config.workflow === 'object');
  const hasStateWorkflow = config?.workflow?.mode === 'state-machine' && Array.isArray(config?.workflow?.states);
  if (!hasWorkflowRoot || !hasStateWorkflow) {
    throw new Error(`不是有效的工作流配置: ${configFile}`);
  }
}
