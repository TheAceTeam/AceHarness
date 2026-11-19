import type { WorkflowScriptInterpreter, WorkflowStep } from '@/lib/core/schemas';

export const SCRIPT_INTERPRETER_LABELS: Record<WorkflowScriptInterpreter, string> = { bash: 'Bash', shell: 'Shell (sh)', powershell: 'PowerShell', cmd: 'CMD', python: 'Python' };
export const SCRIPT_LANGUAGES = { bash: 'shell', shell: 'shell', powershell: 'powershell', cmd: 'bat', python: 'python' } as const;
export type ScriptExecutionRecord = {
  id?: string; stepName: string; status: string; output?: string; error?: string; timestamp?: string; durationMs?: number;
  superseded?: boolean; stepType?: string; agent?: string; scriptInterpreter?: WorkflowScriptInterpreter;
  scriptExitCode?: number | null; scriptFailureAction?: 'continue' | 'transition' | 'stop';
  scriptStdout?: string; scriptStderr?: string; scriptOutputTruncated?: boolean; scriptCancelled?: boolean;
};
export function findScriptExecution(records: ScriptExecutionRecord[], stateName: string, stepName: string) {
  const current = records.filter(record => !record.superseded);
  const matches = (key: string) => key === `${stateName}-${stepName}` || key === `state:${stateName}#${stepName}`
    || key.startsWith(`${stateName}-${stepName}-迭代`) || key.startsWith(`state:${stateName}#${stepName}-迭代`);
  const qualified = current.filter(record => matches(record.stepName));
  const candidates = qualified.length ? qualified : current.filter(record => record.stepName === stepName || record.stepName.startsWith(`${stepName}-迭代`));
  return candidates.reduce<ScriptExecutionRecord | undefined>((last, next) => !last || !next.timestamp || !last.timestamp || Date.parse(next.timestamp) >= Date.parse(last.timestamp) ? next : last, undefined);
}
export function scriptExecutionLabel(record?: ScriptExecutionRecord, running = false) {
  if (record?.scriptCancelled) return '已停止';
  if (record?.status === 'running' || running) return '执行中';
  if (record?.status === 'failed') return record.scriptFailureAction === 'continue' ? '失败 · 继续' : record.scriptFailureAction === 'transition' ? '失败 · 转移' : '失败 · 停止';
  return record?.status === 'completed' ? '已完成' : '待执行';
}
export function scriptDuration(ms?: number) {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  const seconds = Math.max(0, ms) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}秒` : `${Math.floor(seconds / 60)}分${Math.floor(seconds % 60)}秒`;
}
export function scriptFailureLabel(step?: WorkflowStep, record?: ScriptExecutionRecord) {
  const action = record?.scriptFailureAction ?? step?.script?.onFailure.action;
  return action === 'continue' ? '继续执行下一步' : action === 'transition' ? `转移到${step?.script?.onFailure.action === 'transition' ? '：' + step.script.onFailure.target : '指定状态'}` : '停止工作流';
}
