'use client';

import React, { useEffect, useMemo, useState } from 'react';

type NavigateOptions = { scroll?: boolean };
type HrefLike = string | { pathname?: string; query?: Record<string, string | number | boolean | null | undefined> };

function toHref(href: HrefLike): string {
  if (typeof href === 'string') return href;
  const pathname = href.pathname || '/';
  const search = new URLSearchParams();
  Object.entries(href.query || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function emitLocationChange() {
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  window.dispatchEvent(new Event('ace:navigation-change'));
}

function navigate(method: 'pushState' | 'replaceState', href: string, options?: NavigateOptions) {
  if (typeof window === 'undefined') return;
  window.history[method](null, '', href);
  if (options?.scroll !== false) window.scrollTo({ top: 0 });
  emitLocationChange();
}

export function useRouter() {
  return useMemo(() => ({
    push: (href: HrefLike, options?: NavigateOptions) => navigate('pushState', toHref(href), options),
    replace: (href: HrefLike, options?: NavigateOptions) => navigate('replaceState', toHref(href), options),
    refresh: () => {
      if (typeof window !== 'undefined') window.location.reload();
    },
    back: () => {
      if (typeof window !== 'undefined') window.history.back();
    },
    forward: () => {
      if (typeof window !== 'undefined') window.history.forward();
    },
  }), []);
}

function useLocationSnapshot() {
  const [snapshot, setSnapshot] = useState(() => {
    if (typeof window === 'undefined') return { pathname: '/', search: '' };
    return { pathname: window.location.pathname, search: window.location.search };
  });

  useEffect(() => {
    const update = () => setSnapshot({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', update);
    window.addEventListener('ace:navigation-change', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('ace:navigation-change', update);
    };
  }, []);

  return snapshot;
}

export function usePathname() {
  return useLocationSnapshot().pathname;
}

export function useSearchParams() {
  const { search } = useLocationSnapshot();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams() {
  const pathname = usePathname();
  return useMemo(() => {
    const segments = pathname.split('/').filter(Boolean).map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    const params: Record<string, string> = {};
    if (segments[0] === 'workbench' && segments[1]) params.config = segments.slice(1).join('/');
    if (segments[0] && segments[1]) params.id = segments[1];
    return params;
  }, [pathname]);
}

export function notFound(): never {
  throw new Response('Not Found', { status: 404 });
}

const Link = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: HrefLike; replace?: boolean; scroll?: boolean }>(
  ({ href, replace, scroll, onClick, ...props }, ref) => {
    const resolvedHref = toHref(href);
    return (
      <a
        ref={ref}
        href={resolvedHref}
        onClick={(event) => {
          onClick?.(event);
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            props.target
          ) {
            return;
          }
          event.preventDefault();
          navigate(replace ? 'replaceState' : 'pushState', resolvedHref, { scroll });
        }}
        {...props}
      />
    );
  },
);
Link.displayName = 'Link';

export default Link;
