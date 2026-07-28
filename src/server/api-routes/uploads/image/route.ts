import { mkdir, writeFile } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
};

function safeExt(fileName: string, mimeType: string) {
  const byName = extname(fileName || '').toLowerCase();
  if (byName && byName.length <= 6) return byName;
  return IMAGE_MIME_EXT[mimeType] || '.png';
}

function safeBaseName(fileName: string) {
  const base = (fileName || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48);
  return base || 'image';
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return jsonOk({ error: '缺少图片文件' }, { status: 400 });
    }
    if (!file.type?.startsWith('image/')) {
      return jsonOk({ error: '仅支持图片文件' }, { status: 400 });
    }

    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const publicSubDir = join('uploads', 'images', yyyy, mm);
    const absDir = resolve(process.cwd(), 'public', publicSubDir);
    await mkdir(absDir, { recursive: true });

    const ext = safeExt(file.name, file.type);
    const base = safeBaseName(file.name);
    const fileName = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const absPath = join(absDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(absPath, buffer);

    return jsonOk({
      url: `/${publicSubDir.replace(/\\/g, '/')}/${fileName}`,
      absolutePath: absPath,
      fileName,
      size: file.size,
      mimeType: file.type,
    });
  } catch (error: any) {
    return jsonOk({ error: error?.message || '图片上传失败' }, { status: 500 });
  }
}

