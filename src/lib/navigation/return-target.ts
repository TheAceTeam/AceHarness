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
