import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  const source = request.nextUrl.searchParams.get('url') || '';
  if (!source || !isAllowedQrUrl(source)) {
    return NextResponse.json({ error: '二维码图片地址不合法' }, { status: 400 });
  }

  try {
    const upstream = await fetch(source, {
      headers: {
        referer: '',
        'user-agent': 'Mozilla/5.0 ACEHarness WeChat QR Proxy',
      },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `二维码图片拉取失败: HTTP ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '二维码图片代理失败' }, { status: 500 });
  }
}
