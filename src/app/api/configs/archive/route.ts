import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';
import { ZipFile } from 'yazl';
import { parse, stringify } from 'yaml';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessConfigMeta, getConfigMeta, setConfigMeta } from '@/lib/config/metadata';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/core/creator-validation';
import { getRuntimeConfigsDirPath, unmarkConfigDeleted } from '@/lib/run/runtime-configs';

export const dynamic = 'force-dynamic';

type AuthUser = {
  id: string;
  role: 'admin' | 'user';
};

type WorkflowImportCandidate = {
  filename: string;
  normalizedConfig: any;
};

const RESERVED_CONFIG_DIRS = new Set(['agents', 'models', 'notebook', 'settings']);

function isYamlFilename(filename: string): boolean {
  return /\.ya?ml$/i.test(filename);
}

function normalizeArchiveWorkflowPath(input: unknown): string {
  const normalized = String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');

  const segments = normalized.split('/');
  if (
    !normalized
    || !isYamlFilename(normalized)
    || normalized.includes('\0')
    || segments.some((segment) => segment === '.' || segment === '..')
    || RESERVED_CONFIG_DIRS.has(segments[0])
  ) {
    throw Object.assign(new Error('无效 workflow YAML 路径'), { status: 400 });
  }

  return normalized;
}

function resolveInside(baseDir: string, relativePath: string): string {
  const root = path.resolve(baseDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw Object.assign(new Error('无效 workflow YAML 路径'), { status: 400 });
  }
  return target;
}

async function canEditWorkflow(filename: string, user: AuthUser): Promise<boolean> {
  if (user.role === 'admin') return true;
  const meta = await getConfigMeta(filename, 'workflow');
  if (!meta) return true;
  return !meta.createdBy || meta.createdBy === user.id;
}

async function assertExportableWorkflow(filename: string, user: AuthUser): Promise<string> {
  const meta = await getConfigMeta(filename, 'workflow');
  if (!canAccessConfigMeta(meta, user.id, user.role)) {
    throw Object.assign(new Error(`无权限导出工作流: ${filename}`), { status: 403 });
  }

  const configsDir = await getRuntimeConfigsDirPath();
  const filePath = resolveInside(configsDir, filename);
  const content = await fs.readFile(filePath, 'utf-8').catch((error: any) => {
    if (error?.code === 'ENOENT') {
      throw Object.assign(new Error(`找不到工作流: ${filename}`), { status: 404 });
    }
    throw error;
  });
  let parsed: any;
  try {
    parsed = parse(content);
  } catch (error: any) {
    throw Object.assign(new Error(`工作流 YAML 解析失败: ${filename}`), { status: 400, cause: error });
  }
  const validation = validateWorkflowDraft(parsed);
  if (!validation.ok) {
    throw Object.assign(new Error(`工作流配置无效: ${filename}`), {
      status: 400,
      details: formatValidationIssuesForResponse(validation),
    });
  }
  return filePath;
}

async function zipWorkflowFiles(files: Array<{ filename: string; filePath: string }>): Promise<Buffer> {
  const zipfile = new ZipFile();
  for (const file of files) {
    zipfile.addFile(file.filePath, file.filename);
  }

  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    zipfile.outputStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    zipfile.outputStream.on('end', resolve);
    zipfile.outputStream.on('error', reject);
  });
  zipfile.end();
  await done;
  return Buffer.concat(chunks);
}

async function readWorkflowCandidatesFromZip(file: File): Promise<WorkflowImportCandidate[]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const directory = await (unzipper as any).Open.buffer(buffer);
  const seen = new Set<string>();
  const candidates: WorkflowImportCandidate[] = [];

  for (const entry of directory.files || []) {
    if (entry.type !== 'File') continue;
    const rawPath = String(entry.path || '');
    if (!isYamlFilename(rawPath)) continue;

    const filename = normalizeArchiveWorkflowPath(rawPath);
    if (seen.has(filename)) {
      throw Object.assign(new Error(`ZIP 中存在重复的 workflow YAML: ${filename}`), { status: 400 });
    }
    seen.add(filename);

    const content = (await entry.buffer()).toString('utf-8');
    let parsed: any;
    try {
      parsed = parse(content);
    } catch (error: any) {
      throw Object.assign(new Error(`工作流 YAML 解析失败: ${filename}`), { status: 400, cause: error });
    }
    const validation = validateWorkflowDraft(parsed);
    if (!validation.ok || !validation.normalized) {
      throw Object.assign(new Error(`工作流校验失败: ${filename}`), {
        status: 400,
        details: formatValidationIssuesForResponse(validation),
      });
    }

    candidates.push({ filename, normalizedConfig: validation.normalized });
  }

  return candidates;
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const requested: unknown[] = Array.isArray(body?.workflows)
      ? body.workflows
      : Array.isArray(body?.files)
        ? body.files
        : [];
    const workflowFiles: string[] = requested.map((item) => normalizeArchiveWorkflowPath(item));

    if (workflowFiles.length === 0) {
      return NextResponse.json({ error: '请选择要导出的工作流' }, { status: 400 });
    }

    const uniqueWorkflowFiles = Array.from(new Set(workflowFiles));
    const files: Array<{ filename: string; filePath: string }> = [];
    for (const filename of uniqueWorkflowFiles) {
      const filePath = await assertExportableWorkflow(filename, auth as AuthUser);
      files.push({ filename, filePath });
    }

    const zipBuffer = await zipWorkflowFiles(files);
    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="workflows-export.zip"',
      },
    });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    return NextResponse.json(
      {
        error: status === 500 ? '导出失败' : error.message,
        message: error.message,
        details: error.details,
      },
      { status }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: '请上传 ZIP 文件' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: '未找到上传文件' }, { status: 400 });
    }
    if (!/\.zip$/i.test(file.name || '')) {
      return NextResponse.json({ error: '请上传 .zip 文件' }, { status: 400 });
    }

    const configsDir = await getRuntimeConfigsDirPath();
    const candidates = await readWorkflowCandidatesFromZip(file);
    if (candidates.length === 0) {
      return NextResponse.json({ error: 'ZIP 中未找到 workflow YAML' }, { status: 400 });
    }

    for (const candidate of candidates) {
      const existingMeta = await getConfigMeta(candidate.filename, 'workflow');
      if (existingMeta && !(await canEditWorkflow(candidate.filename, auth as AuthUser))) {
        return NextResponse.json({ error: `无权限覆盖工作流: ${candidate.filename}` }, { status: 403 });
      }
    }

    const now = Date.now();
    const imported: string[] = [];
    for (const candidate of candidates) {
      const filePath = resolveInside(configsDir, candidate.filename);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, stringify(candidate.normalizedConfig), 'utf-8');
      await unmarkConfigDeleted(configsDir, candidate.filename);

      const existingMeta = await getConfigMeta(candidate.filename, 'workflow');
      if (!existingMeta) {
        await setConfigMeta(candidate.filename, {
          createdBy: (auth as AuthUser).id,
          visibility: 'private',
          sharedWithUserIds: [],
          createdAt: now,
        }, 'workflow');
      }
      imported.push(candidate.filename);
    }

    return NextResponse.json({
      success: true,
      imported,
      message: `导入了 ${imported.length} 个工作流`,
    });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    return NextResponse.json(
      {
        error: status === 500 ? '导入失败' : error.message,
        message: error.message,
        details: error.details,
      },
      { status }
    );
  }
}
