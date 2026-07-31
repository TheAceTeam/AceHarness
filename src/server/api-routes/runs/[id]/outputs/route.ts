import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { listOutputFiles, loadRunState } from '@/lib/run/state-persistence';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { resolveWorkflowConfigPath } from '@/lib/workflow/config-path';

const RUNS_DIR = getWorkspaceRunsDir();

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const runId = (await params).id;
  const stepName = requestUrl(request).searchParams.get('step');
  const stepLogId = requestUrl(request).searchParams.get('stepLogId');
  const outputRef = requestUrl(request).searchParams.get('outputRef');

  try {
    if (stepLogId || outputRef) {
      const state = await loadRunState(runId, { hydrateLargeOutputs: false });
      const log = state?.stepLogs?.find((item) => {
        if (stepLogId && item.id === stepLogId) return true;
        return outputRef && item.outputRef === outputRef;
      });
      const ref = log?.outputRef || outputRef || '';
      const runRoot = resolve(RUNS_DIR, runId);
      const outputPath = resolve(runRoot, ref);
      if (!ref || ref.includes('..') || (outputPath !== runRoot && !outputPath.startsWith(`${runRoot}\\`) && !outputPath.startsWith(`${runRoot}/`))) {
        return jsonOk({ error: '未找到该步骤的输出' }, { status: 404 });
      }
      try {
        const content = await readFile(outputPath, 'utf-8');
        return jsonOk({ stepName: log?.stepName || stepName || '', content });
      } catch {
        return jsonOk({ error: '未找到该步骤的输出' }, { status: 404 });
      }
    }

    if (stepName) {
      // Return content of a specific step's output
      const safeName = stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
      const outputDir = resolve(RUNS_DIR, runId, 'outputs');
      // Try .md first, then .txt
      let content = '';
      try {
        content = await readFile(resolve(outputDir, `${safeName}.md`), 'utf-8');
      } catch {
        try {
        content = await readFile(resolve(outputDir, `${safeName}.txt`), 'utf-8');
      } catch {
          return jsonOk({ error: '未找到该步骤的输出' }, { status: 404 });
        }
      }
      return jsonOk({ stepName, content });
    }

    // List all output files with metadata from state.yaml
    const files = await listOutputFiles(runId);
    const state = await loadRunState(runId);

    // Build a step→state lookup and enrich with metadata
    const stepStateMap: Record<string, string> = {};
    const stepRoleMap: Record<string, string> = {};
    if (state) {
      // Parse workflow config to get state/step mapping
      try {
        const configPath = await resolveWorkflowConfigPath(state.configFile);
        if (configPath) {
          const configContent = await readFile(configPath, 'utf-8');
          const { parse } = await import('yaml');
          const config = parse(configContent);
          if (Array.isArray(config?.workflow?.states)) {
            for (const state of config.workflow.states) {
              for (const step of Array.isArray(state.steps) ? state.steps : []) {
                stepStateMap[step.name] = state.name;
                stepStateMap[`${state.name}-${step.name}`] = state.name;
                stepRoleMap[step.name] = step.role || 'defender';
                stepRoleMap[`${state.name}-${step.name}`] = step.role || 'defender';
              }
            }
          }
        }
      } catch { /* config not available */ }
    }

    const enrichedFiles = files.map((f) => {
      const stepLog = state?.stepLogs?.find((l) => {
        const safeSL = l.stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
        return safeSL === f.stepName || l.stepName === f.stepName;
      });
      // Find iteration info for the state this step belongs to
      const originalStepName = stepLog?.stepName || f.stepName;
      const stateName = stepStateMap[originalStepName] || '';
      const iterState = stateName && state?.iterationStates?.[stateName];
      return {
        ...f,
        agent: stepLog?.agent || '',
        stateName,
        // Keep the existing output-display field while deriving it from state-machine data.
        phaseName: stateName,
        role: stepRoleMap[originalStepName] || '',
        iteration: iterState ? iterState.currentIteration : null,
        maxIterations: iterState ? iterState.maxIterations : null,
        timestamp: stepLog?.timestamp || '',
        status: stepLog?.status || '',
      };
    });

    return jsonOk({ files: enrichedFiles });
  } catch (error: any) {
    return jsonOk(
      { error: '获取输出失败', message: error.message },
      { status: 500 }
    );
  }
}
