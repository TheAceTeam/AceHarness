'use client';

export interface UploadedImageInfo {
  url: string;
  absolutePath: string;
  fileName: string;
  size: number;
  mimeType: string;
}

export async function uploadImageFile(file: File): Promise<UploadedImageInfo> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/uploads/image', {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `上传失败 (${res.status})`);
  }
  return data as UploadedImageInfo;
}

export function buildImageSnippet(info: UploadedImageInfo): string {
  const safeName = info.fileName?.replace(/\]/g, '') || 'image';
  return [
    `![${safeName}](${info.url})`,
    '',
    `[image_local_path]: ${info.absolutePath}`,
  ].join('\n');
}

