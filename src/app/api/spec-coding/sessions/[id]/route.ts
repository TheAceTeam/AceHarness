import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { appendSpecCodingRevision, buildSpecCodingFromWorkflowConfig, loadCreationSession, rebuildSpecCodingPreservingArtifacts, updateCreationSession } from '@/lib/spec-coding-store';

function canAccess(userId: string, createdBy?: string) {
  return !createdBy || createdBy === userId;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const session = await loadCreationSession(id);
    if (!session) {
      return NextResponse.json({ error: '创建期会话不存在' }, { status: 404 });
    }
    if (!canAccess(auth.id, session.createdBy)) {
      return NextResponse.json({ error: '无权访问该创建期会话' }, { status: 403 });
    }
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '读取创建期会话失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const existing = await loadCreationSession(id);
    if (!existing) {
      return NextResponse.json({ error: '创建期会话不存在' }, { status: 404 });
    }
    if (!canAccess(auth.id, existing.createdBy)) {
      return NextResponse.json({ error: '无权修改该创建期会话' }, { status: 403 });
    }

    const body = await request.json();
    const patch = { ...body } as Record<string, any>;
    const rawPersistMode = patch.persistMode ?? patch.specCoding?.persistMode;
    const incomingPersistMode = rawPersistMode === 'repository'
      ? 'repository'
      : rawPersistMode === 'none'
        ? 'none'
        : undefined;
    const rawSpecRoot = patch.specRoot ?? patch.specCoding?.specRoot;
    const incomingSpecRoot = typeof rawSpecRoot === 'string' ? rawSpecRoot.trim() : undefined;
    if (incomingPersistMode || incomingSpecRoot !== undefined) {
      const nextPersistMode = incomingPersistMode
        || patch.specCoding?.persistMode
        || existing.specCoding?.persistMode
        || 'none';
      patch.specCoding = {
        ...(existing.specCoding || {}),
        ...(patch.specCoding || {}),
        persistMode: nextPersistMode,
        specRoot: nextPersistMode === 'repository'
          ? (incomingSpecRoot || patch.specCoding?.specRoot || existing.specCoding?.specRoot || '.spec')
          : undefined,
      };
      delete patch.persistMode;
      delete patch.specRoot;
    }
    if (patch.rebuildSpecCodingFromConfig && patch.config) {
      patch.specCoding = existing.specCoding
        ? rebuildSpecCodingPreservingArtifacts({
            existing: existing.specCoding,
            workflowName: patch.workflowName || existing.workflowName,
            description: patch.description ?? existing.description,
            requirements: patch.requirements ?? existing.requirements,
            filename: patch.filename || existing.filename,
            workspaceMode: patch.workspaceMode || existing.workspaceMode,
            workingDirectory: patch.workingDirectory || existing.workingDirectory,
            config: patch.config,
            status: patch.specCodingStatus || existing.specCoding.status,
          })
        : buildSpecCodingFromWorkflowConfig({
            workflowName: patch.workflowName || existing.workflowName,
            description: patch.description ?? existing.description,
            requirements: patch.requirements ?? existing.requirements,
            filename: patch.filename || existing.filename,
            workspaceMode: patch.workspaceMode || existing.workspaceMode,
            workingDirectory: patch.workingDirectory || existing.workingDirectory,
            config: patch.config,
          });
      if (patch.specCodingStatus) {
        patch.specCoding = {
          ...patch.specCoding,
          status: patch.specCodingStatus,
          confirmedAt: patch.specCodingStatus === 'confirmed'
          ? (patch.specCoding.confirmedAt || new Date().toISOString())
          : patch.specCoding.confirmedAt,
        };
      }
    } else if (patch.specCoding && patch.specCodingStatus) {
      patch.specCoding = {
        ...patch.specCoding,
        status: patch.specCodingStatus,
        confirmedAt: patch.specCodingStatus === 'confirmed'
          ? (patch.specCoding.confirmedAt || new Date().toISOString())
          : patch.specCoding.confirmedAt,
      };
    }

    if (patch.specCoding && (incomingPersistMode || incomingSpecRoot !== undefined)) {
      const nextPersistMode = incomingPersistMode
        || patch.specCoding.persistMode
        || existing.specCoding?.persistMode
        || 'none';
      patch.specCoding = {
        ...patch.specCoding,
        persistMode: nextPersistMode,
        specRoot: nextPersistMode === 'repository'
          ? (incomingSpecRoot || patch.specCoding.specRoot || existing.specCoding?.specRoot || '.spec')
          : undefined,
      };
    }

    if (patch.specCoding && typeof patch.revisionSummary === 'string' && patch.revisionSummary.trim()) {
      patch.specCoding = appendSpecCodingRevision(patch.specCoding, {
        summary: patch.revisionSummary.trim(),
        createdBy: auth.id,
        status: patch.specCodingStatus || patch.specCoding.status,
        progressSummary: patch.specCodingStatus === 'confirmed'
          ? '计划已确认，可继续整理 workflow 草案。'
          : '创建态 SpecCoding 已根据最新修订说明重新生成，等待再次确认。',
      });
    }

    const session = await updateCreationSession(id, patch);
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '更新创建期会话失败' }, { status: 500 });
  }
}
