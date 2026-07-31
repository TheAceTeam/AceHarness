import { requireAuth } from '@/lib/auth/middleware';
import { buildCreationSession, listCreationSessions, saveCreationSession, loadMasterSpecAsCreationSession, rebuildSpecCodingPreservingArtifacts } from '@/lib/spec/coding-store';
import { assertPersistedSpecRootReady } from '@/lib/spec/persistence';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';
import { jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = requestUrl(request);
    const chatSessionId = searchParams.get('chatSessionId') || undefined;
    const sessions = await listCreationSessions({ chatSessionId, createdBy: auth.id });
    return jsonOk({ sessions });
  } catch (error: any) {
    return jsonOk({ error: error.message || '读取创建期会话失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<any>(request, {});
    const persistMode = body.persistMode === 'repository' ? 'repository' : 'none';
    const specRoot = persistMode === 'repository' ? String(body.specRoot || '').trim() || '.spec' : undefined;
    let specCoding = body.specCoding;

    if (persistMode === 'repository') {
      const readySpecRoot = assertPersistedSpecRootReady(body.workingDirectory, specRoot);
      if (!specCoding && body.workingDirectory && body.filename) {
        const masterSession = await loadMasterSpecAsCreationSession(body.workingDirectory, body.filename, specRoot);
        if (masterSession?.specCoding) {
          specCoding = body.config
            ? rebuildSpecCodingPreservingArtifacts({
                existing: masterSession.specCoding,
                workflowName: body.workflowName,
                description: body.description,
                requirements: body.requirements,
                filename: body.filename,
                workspaceMode: body.workspaceMode,
                workingDirectory: body.workingDirectory,
                config: body.config,
                status: masterSession.specCoding.status,
              })
            : masterSession.specCoding;
          specCoding = { ...specCoding, persistMode, specRoot: readySpecRoot };
        }
      } else if (specCoding) {
        specCoding = { ...specCoding, persistMode, specRoot: readySpecRoot };
      }
    }

    const session = buildCreationSession({
      chatSessionId: body.chatSessionId,
      homeChatSessionId: typeof body.homeChatSessionId === 'string' ? body.homeChatSessionId : undefined,
      createdBy: auth.id,
      status: body.status,
      specCodingStatus: body.specCodingStatus,
      filename: body.filename,
      workflowName: body.workflowName,
      mode: body.mode === 'lightweight' ? 'lightweight' : 'state-machine',
      referenceWorkflow: body.referenceWorkflow,
      planningEngine: typeof body.planningEngine === 'string' ? body.planningEngine : undefined,
      planningModel: typeof body.planningModel === 'string' ? body.planningModel : undefined,
      workingDirectory: body.workingDirectory,
      workspaceMode: body.workspaceMode,
      description: body.description,
      requirements: body.requirements,
      lightweight: body.mode === 'lightweight' && body.lightweight && typeof body.lightweight === 'object'
        ? body.lightweight
        : undefined,
      clarification: body.clarification,
      stageSessions: body.stageSessions,
      uiState: body.uiState,
      config: body.config,
      specCoding,
      persistMode,
      specRoot,
    });
    if (body.config && session.specCoding) {
      session.bindingValidation = compileStepTaskBindings(body.config, session.specCoding).validation as any;
    }
    await saveCreationSession(session);
    return jsonOk({ session });
  } catch (error: any) {
    return jsonOk({ error: error.message || '创建创建期会话失败' }, { status: 500 });
  }
}
