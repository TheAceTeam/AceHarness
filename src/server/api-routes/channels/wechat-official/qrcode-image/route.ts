import { errorMessage, jsonError, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';

const ALLOWED_HOSTS = new Set([
  'liteapp.weixin.qq.com',
  'ilinkai.weixin.qq.com',
]);

function isAllowedQrUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  const source = requestUrl(request).searchParams.get('url') || '';
  if (!source || !isAllowedQrUrl(source)) {
    return jsonError('二维码图片地址不合法', 400);
  }

  try {
    const upstream = await fetch(source, {
      headers: {
        referer: '',
        'user-agent': 'Mozilla/5.0 CSIHarness WeChat QR Proxy',
      },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      return jsonError(`二维码图片拉取失败: HTTP ${upstream.status}`, 502);
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buffer = await upstream.arrayBuffer();
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    return jsonError(errorMessage(error) || '二维码图片代理失败', 500);
  }
}
