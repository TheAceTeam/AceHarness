function normalizeBasePath(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return pathname === '/' ? '' : pathname;
  } catch {
    const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
    const normalized = withSlash.replace(/\/+$/, '');
    return normalized === '/' ? '' : normalized;
  }
}

export function getBasePath(): string {
  const runtimeBasePath = typeof window !== 'undefined'
    ? (window as Window & { __ACE_BASE_PATH?: string }).__ACE_BASE_PATH
    : '';
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return normalizeBasePath(
    runtimeBasePath
      || viteEnv?.VITE_ACE_BASE_URL
      || (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_BASEURL : '')
      || '',
  );
}

export function withBasePath(path: string): string {
  const basePath = getBasePath();
  if (!basePath || !path.startsWith('/') || path.startsWith('//')) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}

function rewriteFetchInput(input: RequestInfo | URL): RequestInfo | URL {
  const basePath = getBasePath();
  if (!basePath) return input;

  if (typeof input === 'string') {
    if (input.startsWith('/') && !input.startsWith('//')) return withBasePath(input);
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(input, window.location.href);
        if (url.origin === window.location.origin) {
          url.pathname = withBasePath(url.pathname);
          return url.href;
        }
      } catch {
        return input;
      }
    }
    return input;
  }

  if (input instanceof URL) {
    if (typeof window !== 'undefined' && input.origin === window.location.origin) {
      const next = new URL(input.href);
      next.pathname = withBasePath(next.pathname);
      return next;
    }
    return input;
  }

  if (typeof Request !== 'undefined' && input instanceof Request && typeof window !== 'undefined') {
    try {
      const url = new URL(input.url);
      if (url.origin === window.location.origin) {
        url.pathname = withBasePath(url.pathname);
        if (url.href !== input.url) return new Request(url.href, input);
      }
    } catch {
      return input;
    }
  }

  return input;
}

export function installBasePathFetchPatch(): void {
  if (typeof window === 'undefined') return;
  const win = window as Window & { __aceBasePathFetchPatched?: boolean };
  if (win.__aceBasePathFetchPatched) return;
  win.__aceBasePathFetchPatched = true;

  const originalFetch = win.fetch.bind(win);
  win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    return originalFetch(rewriteFetchInput(input), init);
  }) as typeof window.fetch;
}
