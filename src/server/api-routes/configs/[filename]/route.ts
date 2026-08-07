import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { readFile, readdir, writeFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessConfigMeta, getConfigMeta, deleteConfigMeta, setConfigMeta } from '@/lib/config/metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeAgentsDirPath, getRuntimeConfigsDirPath, getRuntimeWorkflowConfigPath, markConfigDeleted, unmarkConfigDeleted } from '@/lib/run/runtime-configs';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/core/creator-validation';
import { loadCreationSession, updateCreationSession } from '@/lib/spec/coding-store';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';
import { deleteRunsByConfig } from '@/lib/run/store';
import { workflowRegistry } from '@/lib/workflow/registry';
import { getUserById, loadUsers } from '@/lib/core/user-store';
import { validateSubworkflowDependenciesForConfig } from '@/lib/workflow/subworkflow-config';
import { findWorkflowReferences, updateWorkflowReferences } from '@/lib/workflow/references';
import { isRetiredCatalogAgent } from '@/lib/agent/catalog';
import { ensureDefaultSupervisorConfig } from '@/lib/core/default-supervisor';
import {
  ensureLightweightWorkflowStepSkill,
  isLightweightWorkflowConfig,
  normalizeLightweightWorkflowConfig,
} from '@/lib/workflow/lightweight';

function normalizeConfigFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('无效文件名');
  }
  return normalized;
}

async function canAccessWorkflow(filename: string, userId: string, role: 'admin' | 'user') {
  const meta = await getConfigMeta(filename, 'workflow');
  return canAccessConfigMeta(meta, userId, role);
}

async function canEditWorkflow(filename: string, userId: string, role: 'admin' | 'user') {
  const meta = await getConfigMeta(filename, 'workflow');
  if (role === 'admin') return true;
  if (!meta) return true;
  return !meta.createdBy || meta.createdBy === userId;
}

async function stopRunningWorkflow(filename: string): Promise<void> {
  const manager = workflowRegistry.getRunningManager(filename);
  if (!manager) return;
  await manager.stop();
}

export async function GET(
  request: Request,
  { params }: { params: { filename: string } | Promise<{ filename: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const filename = (await params).filename;
    if (!(await canAccessWorkflow(filename, auth.id, auth.role))) {
      return jsonError('无权限访问该工作流', 403);
    }

    const filepath = await getRuntimeWorkflowConfigPath(filename);
    const content = await readFile(filepath, 'utf-8');
    const config = normalizeLightweightWorkflowConfig(parse(content));
    const validation = validateWorkflowDraft(config, { workflowKey: filename });
    const meta = await getConfigMeta(filename, 'workflow');
    const specCodingDisabled = isLightweightWorkflowConfig(config)
      || meta?.specCodingEnabled === false
      || meta?.specCodingSkipped === true;
    const responseConfig = specCodingDisabled
      ? {
          ...config,
          context: {
            ...(config?.context || {}),
            specCodingEnabled: false,
            skipSpecCoding: true,
          },
        }
      : config;
    const owner = meta?.createdBy ? await getUserById(meta.createdBy).catch(() => undefined) : undefined;

    // Load agents from configs/agents/*.yaml
    const agents: any[] = [];
    try {
      const agentsDir = await getRuntimeAgentsDirPath();
      const files = await readdir(agentsDir);
      for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
        try {
          const agentContent = await readFile(resolve(agentsDir, file), 'utf-8');
          const agent = parse(agentContent);
          if (agent?.name && !isRetiredCatalogAgent(agent)) agents.push(agent);
        } catch { /* skip */ }
      }
    } catch { /* agents dir may not exist */ }

    return jsonOk({
      config: responseConfig,
      raw: content,
      agents: ensureDefaultSupervisorConfig(agents),
      meta: {
        createdBy: meta?.createdBy,
        visibility: meta?.visibility || 'private',
        sharedWithUserIds: meta?.sharedWithUserIds || [],
        createdAt: meta?.createdAt,
        ownerName: owner?.username || '',
        specCodingEnabled: meta?.specCodingEnabled,
        specCodingSkipped: meta?.specCodingSkipped,
      },
      validation: {
        ...formatValidationIssuesForResponse(validation),
        normalized: validation.normalized,
      },
    });
  } catch (error: any) {
    // List available configs to help AI self-correct
    let available: string[] = [];
    try {
      await ensureRuntimeConfigsSeeded();
      const configsDir = await getRuntimeConfigsDirPath();
      const files = await readdir(configsDir);
      available = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch { /* ignore */ }
    const filename = (await params).filename;
    return jsonOk(
      {
        error: '读取配置失败',
        message: `文件 ${filename} 不存在或无法读取`,
        availableConfigs: available,
      },
      { status: 404 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { filename: string } | Promise<{ filename: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const filename = (await params).filename;
    if (!(await canEditWorkflow(filename, auth.id, auth.role))) {
      return jsonError('无权限修改该工作流', 403);
    }

    const body = await readJsonBody<Record<string, any>>(request, {});
    const config = normalizeLightweightWorkflowConfig(body?.config);
    const renameFrom = typeof body?.renameFrom === 'string'
      ? body.renameFrom
      : typeof body?.previousFilename === 'string'
        ? body.previousFilename
        : '';
    const requestedMeta = body?.meta && typeof body.meta === 'object' ? body.meta : null;

    // Strip roles before saving — agents are managed separately
    const { roles, ...configWithoutRoles } = config;

    // Validate config (roles is optional now)
    const validationResult = validateWorkflowDraft(configWithoutRoles, {
      materializeIds: true,
      workflowKey: filename,
    });
    if (!validationResult.ok || !validationResult.normalized) {
      return jsonOk(
        {
          error: '配置验证失败',
          details: formatValidationIssuesForResponse(validationResult),
        },
        { status: 400 }
      );
    }

    let normalizedConfig = ensureLightweightWorkflowStepSkill(validationResult.normalized);
    const dependencyIssues = await validateSubworkflowDependenciesForConfig(normalizedConfig);
    if (dependencyIssues.length > 0) {
      return jsonOk(
        {
          error: '配置验证失败',
          details: dependencyIssues,
        },
        { status: 400 }
      );
    }

    let bindingValidation: any = undefined;
    const creationSessionId = typeof body.creationSessionId === 'string' ? body.creationSessionId : undefined;
    const session = creationSessionId ? await loadCreationSession(creationSessionId).catch(() => null) : null;
    const meta = await getConfigMeta(filename, 'workflow');
    const specCodingDisabled = isLightweightWorkflowConfig(normalizedConfig)
      || normalizedConfig?.context?.specCodingEnabled === false
      || normalizedConfig?.context?.skipSpecCoding === true
      || meta?.specCodingEnabled === false
      || meta?.specCodingSkipped === true;
    const specCoding = specCodingDisabled ? null : (body.specCoding || session?.specCoding);
    if (specCoding) {
      const bindingCompilation = compileStepTaskBindings(normalizedConfig, specCoding, {
        requireFullCoverage: true,
      });
      normalizedConfig = bindingCompilation.config;
      bindingValidation = bindingCompilation.validation;
      if (session) {
        await updateCreationSession(session.id, { bindingValidation: bindingValidation as any });
      }
      if (!bindingValidation.ok) {
        return jsonOk(
          {
            error: '配置验证失败',
            details: bindingValidation.errors.map((message: string) => ({
              path: ['workflow', 'specTaskBinding'],
              message,
              severity: 'error',
            })),
            bindingValidation,
          },
          { status: 400 }
        );
      }
    }

    const filepath = await getRuntimeWorkflowConfigPath(filename);
    const yamlContent = stringify(normalizedConfig);
    await writeFile(filepath, yamlContent, 'utf-8');
    const configsDir = await getRuntimeConfigsDirPath();
    await unmarkConfigDeleted(configsDir, filename);
    if (requestedMeta) {
      const users = await loadUsers();
      const allowedUserIds = new Set(users.filter((user) => user.status === 'active').map((user) => user.id));
      const visibility = requestedMeta.visibility === 'public' || requestedMeta.visibility === 'shared'
        ? requestedMeta.visibility
        : 'private';
      const sharedWithUserIds = Array.isArray(requestedMeta.sharedWithUserIds)
        ? requestedMeta.sharedWithUserIds.filter((item: unknown): item is string => typeof item === 'string' && allowedUserIds.has(item))
        : [];
      await setConfigMeta(filename, {
        visibility,
        sharedWithUserIds: visibility === 'shared' ? sharedWithUserIds : [],
      }, 'workflow');
    }
    const referenceUpdate = renameFrom && normalizeConfigFilename(renameFrom) !== filename
      ? await updateWorkflowReferences(renameFrom, filename, { id: auth.id, role: auth.role })
      : undefined;

    return jsonOk({ success: true, message: '配置已保存', bindingValidation, referenceUpdate });
  } catch (error: any) {
    return jsonError('保存配置失败', 500, errorMessage(error));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { filename: string } | Promise<{ filename: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const filename = (await params).filename;
    normalizeConfigFilename(filename);
    if (!(await canEditWorkflow(filename, auth.id, auth.role))) {
      return jsonError('无权限删除该工作流', 403);
    }
    const force = requestUrl(request).searchParams.get('force') === '1';
    const references = await findWorkflowReferences(filename, { id: auth.id, role: auth.role });
    if (!force && references.length > 0) {
      return jsonOk({
        error: '该工作流正在被其他工作流引用',
        code: 'WORKFLOW_REFERENCED',
        referenceCount: references.reduce((sum, item) => sum + item.refs.length, 0),
        workflowCount: references.length,
        references,
      }, { status: 409 });
    }
    await stopRunningWorkflow(filename);
    const filepath = await getRuntimeWorkflowConfigPath(filename);
    await unlink(filepath);
    const configsDir = await getRuntimeConfigsDirPath();
    await markConfigDeleted(configsDir, filename);
    await deleteConfigMeta(filename, 'workflow');
    const runsCleanup = await deleteRunsByConfig(filename);
    return jsonOk({
      success: true,
      message: runsCleanup.deletedCount > 0
        ? `配置已删除，并清理 ${runsCleanup.deletedCount} 条运行记录`
        : '配置已删除',
      deletedRunsCount: runsCleanup.deletedCount,
      deletedRunIds: runsCleanup.runIds,
    });
  } catch (error: any) {
    return jsonError('删除配置失败', 500, errorMessage(error));
  }
}
