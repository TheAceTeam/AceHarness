import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { appendOpenSpecRevision, buildOpenSpecFromWorkflowConfig, loadCreationSession, rebuildOpenSpecPreservingArtifacts, updateCreationSession } from '@/lib/openspec-store';

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
    if (patch.rebuildOpenSpecFromConfig && patch.config) {
      patch.openSpec = existing.openSpec
        ? rebuildOpenSpecPreservingArtifacts({
            existing: existing.openSpec,
            workflowName: patch.workflowName || existing.workflowName,
            description: patch.description ?? existing.description,
            requirements: patch.requirements ?? existing.requirements,
            filename: patch.filename || existing.filename,
            workspaceMode: patch.workspaceMode || existing.workspaceMode,
            workingDirectory: patch.workingDirectory || existing.workingDirectory,
            config: patch.config,
            status: patch.openSpecStatus || existing.openSpec.status,
          })
        : buildOpenSpecFromWorkflowConfig({
            workflowName: patch.workflowName || existing.workflowName,
            description: patch.description ?? existing.description,
            requirements: patch.requirements ?? existing.requirements,
            filename: patch.filename || existing.filename,
            workspaceMode: patch.workspaceMode || existing.workspaceMode,
            workingDirectory: patch.workingDirectory || existing.workingDirectory,
            config: patch.config,
          });
      if (patch.openSpecStatus) {
        patch.openSpec = {
          ...patch.openSpec,
          status: patch.openSpecStatus,
          confirmedAt: patch.openSpecStatus === 'confirmed'
          ? (patch.openSpec.confirmedAt || new Date().toISOString())
          : patch.openSpec.confirmedAt,
        };
      }
    } else if (patch.openSpec && patch.openSpecStatus) {
      patch.openSpec = {
        ...patch.openSpec,
        status: patch.openSpecStatus,
        confirmedAt: patch.openSpecStatus === 'confirmed'
          ? (patch.openSpec.confirmedAt || new Date().toISOString())
          : patch.openSpec.confirmedAt,
      };
    }

    if (patch.openSpec && typeof patch.revisionSummary === 'string' && patch.revisionSummary.trim()) {
      patch.openSpec = appendOpenSpecRevision(patch.openSpec, {
        summary: patch.revisionSummary.trim(),
        createdBy: auth.id,
        status: patch.openSpecStatus || patch.openSpec.status,
        progressSummary: patch.openSpecStatus === 'confirmed'
          ? '计划已确认，可继续整理 workflow 草案。'
          : '创建态 OpenSpec 已根据最新修订说明重新生成，等待再次确认。',
      });
    }

    const session = await updateCreationSession(id, patch);
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '更新创建期会话失败' }, { status: 500 });
  }
}
