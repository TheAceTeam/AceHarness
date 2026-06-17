import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodIssue } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import {
  appendSpecCodingRevision,
  buildSpecCodingFromWorkflowConfig,
  deleteCreationSession,
  loadCreationSession,
  normalizeSpecCodingDocument,
  rebuildSpecCodingPreservingArtifacts,
  updateCreationSession,
} from '@/lib/spec/coding-store';
import { validateSpecArtifactsQuality } from '@/lib/spec/artifact-quality';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';

function canAccess(userId: string, createdBy?: string) {
  return !createdBy || createdBy === userId;
}

function formatIssuePath(path: Array<string | number>): string {
  if (!path.length) return '根节点';
  return path
    .map((segment) => typeof segment === 'number' ? `[${segment}]` : segment)
    .join('.')
    .replace(/\.\[/g, '[');
}

function formatZodIssue(issue: ZodIssue): string {
  const path = formatIssuePath((issue.path || []).filter((segment): segment is string | number => (
    typeof segment === 'string' || typeof segment === 'number'
  )));
  switch (issue.code) {
    case 'invalid_type': {
      const expected = 'expected' in issue ? String(issue.expected) : '正确类型';
      const received = 'received' in issue ? String(issue.received) : '当前值';
      return `${path} 类型不正确：期望 ${expected}，实际是 ${received}。`;
    }
    case 'invalid_value': {
      const options = Array.isArray((issue as any).values) ? (issue as any).values.join(' / ') : '允许值';
      return `${path} 的取值不合法；请改为 ${options} 之一。`;
    }
    case 'too_small':
    case 'too_big':
      return `${path} ${issue.message || '不满足长度或范围要求。'}`;
    default:
      return `${path} ${issue.message || '格式不合法。'}`;
  }
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
    if (patch.specCoding) {
      patch.specCoding = {
        ...existing.specCoding,
        ...patch.specCoding,
        progress: patch.specCoding.progress
          ? {
              ...existing.specCoding.progress,
              ...patch.specCoding.progress,
            }
          : existing.specCoding.progress,
        artifacts: patch.specCoding.artifacts
          ? {
              ...existing.specCoding.artifacts,
              ...patch.specCoding.artifacts,
            }
          : existing.specCoding.artifacts,
      };
    }
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

    if (patch.specCoding && (patch.specCodingStatus === 'confirmed' || (typeof patch.revisionSummary === 'string' && patch.revisionSummary.trim()))) {
      const qualityValidation = validateSpecArtifactsQuality(patch.specCoding?.artifacts || {});
      const taskValidation = qualityValidation.taskValidation;
      if (!taskValidation.ok) {
        return NextResponse.json({
          error: `tasks.md 格式不合法：${taskValidation.errors[0]}`,
          taskValidation,
          qualityValidation,
        }, { status: 400 });
      }
      if (!qualityValidation.ok) {
        return NextResponse.json({
          error: `Spec 制品质量校验未通过：${qualityValidation.errors[0]?.message || '请补齐 requirements/design/tasks 内容'}`,
          qualityValidation,
          taskValidation,
        }, { status: 400 });
      }
    }

    if (patch.specCoding && typeof patch.revisionSummary === 'string' && patch.revisionSummary.trim()) {
      patch.specCoding = normalizeSpecCodingDocument(patch.specCoding);
      patch.specCoding = appendSpecCodingRevision(patch.specCoding, {
        summary: patch.revisionSummary.trim(),
        createdBy: auth.id,
        status: patch.specCodingStatus || patch.specCoding.status,
        progressSummary: patch.specCodingStatus === 'confirmed'
          ? '计划已确认，可继续整理 workflow 草案。'
          : '创建态 SpecCoding 已根据最新修订说明重新生成，等待再次确认。',
        });
    }

    if (patch.config && (patch.specCoding || existing.specCoding)) {
      patch.bindingValidation = compileStepTaskBindings(
        patch.config,
        patch.specCoding || existing.specCoding
      ).validation as any;
    }

    const session = await updateCreationSession(id, patch);
    return NextResponse.json({ session });
  } catch (error: any) {
    if (error instanceof ZodError) {
      const details = error.issues.map(formatZodIssue);
      return NextResponse.json({
        error: details[0] || 'Spec 计划内容格式不合法',
        details,
        validationIssues: error.issues,
      }, { status: 400 });
    }
    return NextResponse.json({ error: error.message || '更新创建期会话失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const existing = await loadCreationSession(id);
    if (!existing) {
      return NextResponse.json({ error: '创建期会话不存在' }, { status: 404 });
    }
    if (!canAccess(auth.id, existing.createdBy)) {
      return NextResponse.json({ error: '无权删除该创建期会话' }, { status: 403 });
    }
    await deleteCreationSession(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '删除创建期会话失败' }, { status: 500 });
  }
}
