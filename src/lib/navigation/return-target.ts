export type ReturnTarget = {
  href: string;
  label: string;
};

export function getOfficeAwareReturnTarget(from?: string | null): ReturnTarget {
  if (from === 'office') {
    return { href: '/office', label: '返回办公室' };
  }
  return { href: '/dashboard', label: '返回首页' };
}

export function withOfficeSource(href: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}from=office`;
}

export function normalizeAuthReturnTo(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  const parsed = new URL(trimmed, 'http://aceharness.local');
  parsed.searchParams.delete('returnTo');
  const path = parsed.pathname || '/';
  if (path === '/login' || path.startsWith('/login/')) return null;
  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return normalized || '/';
}

export function getCurrentAuthReturnTo(fallback = '/'): string {
  if (typeof window === 'undefined') return fallback;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return normalizeAuthReturnTo(current) || fallback;
}

export function buildLoginHref(returnTo?: string | null): string {
  const target = normalizeAuthReturnTo(returnTo);
  if (!target) return '/login';
  return `/login?returnTo=${encodeURIComponent(target)}`;
}
