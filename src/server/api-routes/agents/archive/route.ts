import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';
import { ZipFile } from 'yazl';
import { parse, stringify } from 'yaml';
import { formatValidationIssuesForResponse, validateAgentDraft } from '@/lib/core/creator-validation';
import { getRuntimeAgentsDirPath } from '@/lib/run/runtime-configs';
import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

type AgentImportCandidate = {
  name: string;
  normalizedConfig: any;
  sourcePath: string;
};

function isYamlFilename(filename: string): boolean {
  return /\.ya?ml$/i.test(filename);
}

function validateAgentName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim() : '';
  if (
    !value
    || value.includes('\0')
    || value.includes('..')
    || value.includes('/')
    || value.includes('\\')
  ) {
    throw Object.assign(new Error('包含无效 Agent 名称'), { status: 400 });
  }
  return value;
}

function normalizeArchivePath(input: unknown): string {
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
  ) {
    throw Object.assign(new Error('无效 Agent YAML 路径'), { status: 400 });
  }
  return normalized;
}

async function findAgentFile(agentsDir: string, name: string): Promise<string | null> {
  const normalizedName = validateAgentName(name);
  for (const extension of ['.yaml', '.yml']) {
    const filePath = path.join(agentsDir, `${normalizedName}${extension}`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

async function zipAgentFiles(files: Array<{ name: string; filePath: string }>): Promise<Buffer> {
  const zipfile = new ZipFile();
  for (const file of files) {
    zipfile.addFile(file.filePath, `${file.name}${path.extname(file.filePath) || '.yaml'}`);
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

async function readAgentCandidatesFromZip(file: File): Promise<AgentImportCandidate[]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const directory = await (unzipper as any).Open.buffer(buffer);
  const candidates: AgentImportCandidate[] = [];
  const seenNames = new Set<string>();

  for (const entry of directory.files || []) {
    if (entry.type !== 'File') continue;
    if (!isYamlFilename(String(entry.path || ''))) continue;
    const sourcePath = normalizeArchivePath(entry.path);
    const content = (await entry.buffer()).toString('utf-8');
    let parsed: any;
    try {
      parsed = parse(content);
    } catch (error: any) {
      throw Object.assign(new Error(`Agent YAML 解析失败: ${sourcePath}`), { status: 400, cause: error });
    }

    const validation = validateAgentDraft(parsed);
    if (!validation.ok || !validation.normalized) {
      throw Object.assign(new Error(`Agent 校验失败: ${sourcePath}`), {
        status: 400,
        details: formatValidationIssuesForResponse(validation),
      });
    }

    const name = validateAgentName(validation.normalized.name);
    if (seenNames.has(name)) {
      throw Object.assign(new Error(`ZIP 中存在重复的 Agent: ${name}`), { status: 400 });
    }
    seenNames.add(name);
    candidates.push({ name, normalizedConfig: validation.normalized, sourcePath });
  }

  return candidates;
}

export async function PUT(request: Request) {
  try {
    const body = await readJsonBody<{ agents?: unknown }>(request, {});
    const names: string[] = [];
    if (Array.isArray(body.agents)) {
      for (const item of body.agents) {
        names.push(validateAgentName(item));
      }
    }
    const uniqueNames: string[] = Array.from(new Set(names));

    if (uniqueNames.length === 0) {
      return jsonError('请选择要导出的 Agent', 400);
    }

    const agentsDir = await getRuntimeAgentsDirPath();
    const files: Array<{ name: string; filePath: string }> = [];
    const missing: string[] = [];
    for (const name of uniqueNames) {
      const filePath = await findAgentFile(agentsDir, name);
      if (!filePath) {
        missing.push(name);
        continue;
      }
      files.push({ name, filePath });
    }

    if (missing.length > 0) {
      return jsonError(`找不到 Agent: ${missing.join(', ')}`, 404);
    }

    const zipBuffer = await zipAgentFiles(files);
    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="agents-export.zip"',
      },
    });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    return jsonOk(
      {
        error: status === 500 ? '导出失败' : error.message,
        message: error.message,
        details: error.details,
      },
      { status }
    );
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonError('请上传 ZIP 文件', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return jsonError('未找到上传文件', 400);
    }
    if (!/\.zip$/i.test(file.name || '')) {
      return jsonError('请上传 .zip 文件', 400);
    }

    const candidates = await readAgentCandidatesFromZip(file);
    if (candidates.length === 0) {
      return jsonError('ZIP 中未找到 Agent YAML', 400);
    }

    const agentsDir = await getRuntimeAgentsDirPath();
    await fs.mkdir(agentsDir, { recursive: true });

    const imported: string[] = [];
    for (const candidate of candidates) {
      const filePath = path.join(agentsDir, `${candidate.name}.yaml`);
      await fs.writeFile(filePath, stringify(candidate.normalizedConfig), 'utf-8');
      imported.push(candidate.name);
    }

    return jsonOk({
      success: true,
      imported,
      message: `导入了 ${imported.length} 个 Agent`,
    });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    return jsonOk(
      {
        error: status === 500 ? '导入失败' : error.message,
        message: error.message,
        details: error.details,
      },
      { status }
    );
  }
}
