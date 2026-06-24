import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { appendPersistedSpecRevision, classifyPersistedSpecFile } from '@/lib/spec/persistence';
import {
  WORKSPACE_BLOB_PREVIEW_SIZE_LIMIT,
  WORKSPACE_TEXT_FILE_SIZE_LIMIT,
  assertSafeRelativePath,
  isInsidePath,
  resolveCreatableInsideWorkspace,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
  workspaceErrorResponse,
} from '@/lib/core/workspace-path-safety';
import { getRemoteWorkspace, isRemoteWorkspace } from '@/lib/core/remote-workspace';
import { getRemoteCredentials, remoteCredentialErrorBody, requireRemoteWorkspaceAuth } from '@/lib/core/remote-credential-vault';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';

const MAX_FILE_SIZE = WORKSPACE_TEXT_FILE_SIZE_LIMIT;

function toPortablePath(input: string): string {
  return input.replace(/\\/g, '/');
}

function isAgentsSkillsRelativePath(rootPath: string, lexicalPath: string): boolean {
  const relativePath = toPortablePath(path.relative(rootPath, lexicalPath));
  return relativePath === '.agents/skills' || relativePath.startsWith('.agents/skills/');
}

async function resolveExistingReadableWorkspaceFile(root: string, file: string): Promise<string> {
  try {
    return await resolveExistingInsideWorkspace(root, file);
  } catch (error: any) {
    if (error?.status !== 403) throw error;
  }

  const lexicalPath = path.resolve(root, assertSafeRelativePath(file));
  if (!isInsidePath(root, lexicalPath) || !isAgentsSkillsRelativePath(root, lexicalPath)) {
    return resolveExistingInsideWorkspace(root, file);
  }

  const realPath = await fs.realpath(lexicalPath);
  const runtimeSkillsDir = await getRuntimeSkillsDirPath();
  const realRuntimeSkillsDir = await fs.realpath(runtimeSkillsDir);
  if (!isInsidePath(realRuntimeSkillsDir, realPath)) {
    return resolveExistingInsideWorkspace(root, file);
  }
  return realPath;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace');
    const file = searchParams.get('file');
    const mode = searchParams.get('mode');

    if (!workspace || !file) {
      return NextResponse.json({ error: '缺少 workspace 或 file 参数' }, { status: 400 });
    }

    if (isRemoteWorkspace(workspace)) {
      const auth = await requireRemoteWorkspaceAuth(request);
      if (auth instanceof NextResponse) return auth;
      const credentials = getRemoteCredentials({ userId: auth.id, workspace });
      const { provider } = getRemoteWorkspace(workspace, credentials);
      const stat = await provider.stat(file);
      if (stat.type !== 'file') {
        return NextResponse.json({ error: '不是文件' }, { status: 400 });
      }
      if (mode === 'blob') {
        if (stat.size > WORKSPACE_BLOB_PREVIEW_SIZE_LIMIT) {
          return NextResponse.json({ error: '文件超过 50MB 预览限制', size: stat.size, path: file }, { status: 413 });
        }
        const buffer = await provider.readFile(file);
        const ext = path.extname(file).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.pdf': 'application/pdf',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
          '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
        };
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': mimeMap[ext] || 'application/octet-stream',
            'Content-Length': String(buffer.length),
          },
        });
      }
      if (stat.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: '文件超过 1MB 限制', size: stat.size, path: file }, { status: 413 });
      }
      const content = (await provider.readFile(file)).toString('utf-8');
      return NextResponse.json({ content, size: stat.size, path: file });
    }

    const resolvedWorkspace = await resolveWorkspaceRoot(workspace);
    const realPath = await resolveExistingReadableWorkspaceFile(resolvedWorkspace, file);
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: '不是文件' }, { status: 400 });
    }

    if (mode === 'blob') {
      if (stat.size > WORKSPACE_BLOB_PREVIEW_SIZE_LIMIT) {
        return NextResponse.json(
          { error: '文件超过 50MB 预览限制', size: stat.size, path: file },
          { status: 413 }
        );
      }

      const buffer = await fs.readFile(realPath);
      const ext = path.extname(file).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
      };
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': mimeMap[ext] || 'application/octet-stream',
          'Content-Length': String(stat.size),
        },
      });
    }

    if (stat.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '文件超过 1MB 限制', size: stat.size, path: file },
        { status: 413 }
      );
    }

    const content = await fs.readFile(realPath, 'utf-8');
    return NextResponse.json({ content, size: stat.size, path: file });
  } catch (error: any) {
    if (error?.status === 428) {
      const workspace = new URL(request.url).searchParams.get('workspace') || '';
      return NextResponse.json(remoteCredentialErrorBody(workspace), { status: 428 });
    }
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}

export async function PUT(request: NextRequest) {
  let workspaceForError = '';
  try {
    const body = await request.json();
    const { workspace, file, content } = body;
    workspaceForError = typeof workspace === 'string' ? workspace : '';

    if (!workspace || !file || content === undefined) {
      return NextResponse.json({ error: '缺少 workspace、file 或 content 参数' }, { status: 400 });
    }

    if (new TextEncoder().encode(content).length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '内容超过 1MB 限制' }, { status: 413 });
    }

    if (isRemoteWorkspace(workspace)) {
      const auth = await requireRemoteWorkspaceAuth(request);
      if (auth instanceof NextResponse) return auth;
      const credentials = getRemoteCredentials({ userId: auth.id, workspace });
      const { provider } = getRemoteWorkspace(workspace, credentials);
      await provider.writeFile(file, content);
      return NextResponse.json({ success: true });
    }

    const resolvedWorkspace = await resolveWorkspaceRoot(workspace);
    const { fullPath } = await resolveCreatableInsideWorkspace(resolvedWorkspace, file);

    const previousContent = await fs.readFile(fullPath, 'utf-8').catch(() => null);
    if (previousContent !== null) {
      await resolveExistingInsideWorkspace(resolvedWorkspace, file);
    }

    await fs.writeFile(fullPath, content, 'utf-8');

    if (previousContent !== null && previousContent !== content) {
      const classification = classifyPersistedSpecFile(resolvedWorkspace, file);
      if (classification) {
        const summary = classification.kind === 'master'
          ? '用户直接保存 master spec.md'
          : `用户直接保存 delta ${classification.artifact}.md`;
        await appendPersistedSpecRevision(classification.targetDir, {
          summary,
          createdBy: 'workspace-editor',
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.status === 428) {
      return NextResponse.json(remoteCredentialErrorBody(workspaceForError), { status: 428 });
    }
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
