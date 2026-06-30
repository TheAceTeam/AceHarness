import { readdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { canAccessConfigMeta, listConfigsWithMeta } from '@/lib/config/metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';

export interface WorkflowReferenceEntry {
  filename: string;
  name: string;
  description: string;
  refs: Array<{
    stateName: string;
    stepName: string;
    configFile: string;
  }>;
}

export function normalizeWorkflowReference(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\\/g, '/').trim() : '';
}

function collectSubworkflowRefs(config: any): WorkflowReferenceEntry['refs'] {
  const states = Array.isArray(config?.workflow?.states) ? config.workflow.states : [];
  const refs: WorkflowReferenceEntry['refs'] = [];
  for (const state of states) {
    for (const step of Array.isArray(state?.steps) ? state.steps : []) {
      if (step?.type !== 'subworkflow') continue;
      const configFile = normalizeWorkflowReference(step.workflow) || normalizeWorkflowReference(step.subworkflow?.configFile);
      if (!configFile) continue;
      refs.push({
        stateName: typeof state?.name === 'string' ? state.name : '',
        stepName: typeof step?.name === 'string' ? step.name : '',
        configFile,
      });
    }
  }
  return refs;
}

async function listWorkflowFiles(configsDir: string): Promise<string[]> {
  const entries = await readdir(configsDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      files.push(entry.name);
      continue;
    }
    if (!entry.isDirectory() || entry.name === 'agents') continue;
    const subEntries = await readdir(resolve(configsDir, entry.name), { withFileTypes: true }).catch(() => []);
    for (const subEntry of subEntries) {
      if (subEntry.isFile() && (subEntry.name.endsWith('.yaml') || subEntry.name.endsWith('.yml'))) {
        files.push(`${entry.name}/${subEntry.name}`);
      }
    }
  }
  return files;
}

export async function findWorkflowReferences(targetConfigFile: string, auth: { id: string; role: 'admin' | 'user' }): Promise<WorkflowReferenceEntry[]> {
  const target = normalizeWorkflowReference(targetConfigFile);
  if (!target) return [];

  await ensureRuntimeConfigsSeeded();
  const configsDir = await getRuntimeConfigsDirPath();
  const metaMap = await listConfigsWithMeta('workflow');
  const files = await listWorkflowFiles(configsDir);
  const references: WorkflowReferenceEntry[] = [];

  for (const file of files) {
    if (normalizeWorkflowReference(file) === target) continue;
    const meta = metaMap[file];
    if (!canAccessConfigMeta(meta, auth.id, auth.role)) continue;
    const raw = await readFile(resolve(configsDir, file), 'utf-8').catch(() => '');
    if (!raw) continue;
    const config = parse(raw);
    const refs = collectSubworkflowRefs(config).filter((ref) => normalizeWorkflowReference(ref.configFile) === target);
    if (!refs.length) continue;
    references.push({
      filename: file,
      name: typeof config?.workflow?.name === 'string' ? config.workflow.name : file,
      description: typeof config?.workflow?.description === 'string' ? config.workflow.description : '',
      refs,
    });
  }

  return references;
}

export async function updateWorkflowReferences(
  oldConfigFile: string,
  newConfigFile: string,
  auth: { id: string; role: 'admin' | 'user' },
): Promise<{ updated: Array<{ filename: string; count: number }>; skipped: string[] }> {
  const oldRef = normalizeWorkflowReference(oldConfigFile);
  const newRef = normalizeWorkflowReference(newConfigFile);
  if (!oldRef || !newRef || oldRef === newRef) return { updated: [], skipped: [] };

  await ensureRuntimeConfigsSeeded();
  const configsDir = await getRuntimeConfigsDirPath();
  const metaMap = await listConfigsWithMeta('workflow');
  const files = await listWorkflowFiles(configsDir);
  const updated: Array<{ filename: string; count: number }> = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (normalizeWorkflowReference(file) === newRef) continue;
    const meta = metaMap[file];
    if (!canAccessConfigMeta(meta, auth.id, auth.role)) {
      skipped.push(file);
      continue;
    }
    const fullPath = resolve(configsDir, file);
    const raw = await readFile(fullPath, 'utf-8').catch(() => '');
    if (!raw) continue;
    const config = parse(raw);
    const states = Array.isArray(config?.workflow?.states) ? config.workflow.states : [];
    let count = 0;
    for (const state of states) {
      for (const step of Array.isArray(state?.steps) ? state.steps : []) {
        if (step?.type !== 'subworkflow') continue;
        if (normalizeWorkflowReference(step.workflow) === oldRef) {
          step.workflow = newRef;
          count++;
        }
        if (normalizeWorkflowReference(step.subworkflow?.configFile) === oldRef) {
          step.subworkflow = { ...(step.subworkflow || {}), configFile: newRef };
          count++;
        }
      }
    }
    if (count > 0) {
      await writeFile(fullPath, stringify(config), 'utf-8');
      updated.push({ filename: file, count });
    }
  }

  return { updated, skipped };
}
