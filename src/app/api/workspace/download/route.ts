import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import yazl from 'yazl';
import {
  WORKSPACE_ARCHIVE_FILE_COUNT_LIMIT,
  WORKSPACE_ARCHIVE_TOTAL_SIZE_LIMIT,
  WorkspacePathError,
  isInsidePath,
  resolveExistingInsideWorkspace,
  resolveWorkspaceRoot,
  sanitizeDownloadName,
  workspaceErrorResponse,
} from '@/lib/workspace-path-safety';

async function collectArchiveFiles(root: string, dirPath: string): Promise<Array<{ fullPath: string; entryName: string; size: number }>> {
  const files: Array<{ fullPath: string; entryName: string; size: number }> = [];
  const stack = [dirPath];
  let totalSize = 0;

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new WorkspacePathError(`目录包含符号链接，已拒绝打包: ${path.relative(root, fullPath)}`, 403);
      }

      const realPath = await fs.realpath(fullPath);
      if (!isInsidePath(root, realPath)) {
        throw new WorkspacePathError('路径不合法', 403);
      }

      if (entry.isDirectory()) {
        stack.push(realPath);
      } else if (entry.isFile()) {
        const stat = await fs.stat(realPath);
        totalSize += stat.size;
        if (totalSize > WORKSPACE_ARCHIVE_TOTAL_SIZE_LIMIT) {
          throw new WorkspacePathError('目录超过 200MB 下载限制', 413);
        }
        if (files.length + 1 > WORKSPACE_ARCHIVE_FILE_COUNT_LIMIT) {
          throw new WorkspacePathError(`目录文件数量超过 ${WORKSPACE_ARCHIVE_FILE_COUNT_LIMIT} 个限制`, 413);
        }

        const entryName = path.relative(dirPath, realPath).split(path.sep).join('/');
        if (!entryName || entryName.startsWith('../') || path.isAbsolute(entryName)) {
          throw new WorkspacePathError('压缩包路径不合法', 403);
        }
        files.push({ fullPath: realPath, entryName, size: stat.size });
      }
    }
  }

  return files;
}

async function createZipBuffer(root: string, dirPath: string): Promise<Buffer> {
  const files = await collectArchiveFiles(root, dirPath);
  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];

  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });

  for (const file of files) {
    zip.addFile(file.fullPath, file.entryName);
  }
  zip.end();

  return done;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace');
    const targetPath = searchParams.get('path') || '';

    if (!workspace) {
      return NextResponse.json({ error: '缺少 workspace 参数' }, { status: 400 });
    }

    const root = await resolveWorkspaceRoot(workspace);
    const fullPath = targetPath ? await resolveExistingInsideWorkspace(root, targetPath) : root;
    const stat = await fs.lstat(fullPath);

    if (stat.isSymbolicLink()) {
      return NextResponse.json({ error: '不能下载符号链接' }, { status: 403 });
    }

    if (stat.isFile()) {
      const buffer = await fs.readFile(fullPath);
      const filename = sanitizeDownloadName(path.basename(fullPath));
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(stat.size),
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (stat.isDirectory()) {
      const buffer = await createZipBuffer(root, fullPath);
      const folderName = sanitizeDownloadName(path.basename(fullPath) || 'workspace');
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(buffer.length),
          'Content-Disposition': `attachment; filename="${folderName}.zip"`,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    return NextResponse.json({ error: '路径不是文件或目录' }, { status: 400 });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message, message }, { status });
  }
}
