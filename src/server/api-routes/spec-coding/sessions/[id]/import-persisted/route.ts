import { requireAuth } from '@/lib/auth/middleware';
import {
  appendSpecCodingRevision,
  loadCreationSession,
  normalizeSpecCodingDocument,
  updateCreationSession,
} from '@/lib/spec/coding-store';
import { getSpecRootDir, readMasterSpec } from '@/lib/spec/persistence';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

function canAccess(userId: string, createdBy?: string) {
  return !createdBy || createdBy === userId;
}

export async function POST(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;
    const session = await loadCreationSession(id);
    if (!session) {
      return jsonOk({ error: '创建期会话不存在' }, { status: 404 });
    }
    if (!canAccess(auth.id, session.createdBy)) {
      return jsonOk({ error: '无权修改该创建期会话' }, { status: 403 });
    }

    const body = await readJsonBody<any>(request, {});
    const specRoot = typeof body.specRoot === 'string' && body.specRoot.trim()
      ? body.specRoot.trim()
      : session.specCoding.specRoot || '.spec';
    const specRootDir = getSpecRootDir(session.workingDirectory, specRoot);
    const masterSpec = await readMasterSpec(specRootDir);
    if (!masterSpec) {
      return jsonOk({ error: 'workspace master spec.md 不存在或无法读取' }, { status: 404 });
    }

    let nextSpecCoding = normalizeSpecCodingDocument({
      ...session.specCoding,
      artifacts: {
        ...session.specCoding.artifacts,
        requirements: masterSpec.artifacts.requirements || session.specCoding.artifacts.requirements || '',
      },
      persistMode: 'repository',
      specRoot: specRootDir,
      updatedAt: new Date().toISOString(),
    });

    nextSpecCoding = appendSpecCodingRevision(nextSpecCoding, {
      summary: body.summary || '用户从 workspace master spec.md 导入修订',
      createdBy: auth.id,
      status: nextSpecCoding.status,
      progressSummary: '已按用户请求从 workspace master spec.md 导入到创建期工作流。',
    });

    const patch: any = { specCoding: nextSpecCoding };
    if (body.config) {
      patch.bindingValidation = compileStepTaskBindings(body.config, nextSpecCoding).validation as any;
    }

    const updated = await updateCreationSession(session.id, patch);
    return jsonOk({ session: updated });
  } catch (error: any) {
    return jsonOk(
      { error: '导入 workspace master spec 失败', message: error.message || String(error) },
      { status: 500 }
    );
  }
}
