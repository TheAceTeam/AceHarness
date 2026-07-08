import { ApiError } from './query-client';
import { withBasePath } from '../base-url';

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  authRedirect?: boolean;
};

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function clearAuthSession(options: { emitEvent?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('auth-token');
  window.localStorage.removeItem('auth-user');
  if (options.emitEvent !== false) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
}

function handleUnauthorized(redirect = true) {
  if (typeof window === 'undefined') return;
  clearAuthSession();
  if (!redirect) return;
  if (window.location.pathname !== withBasePath('/login')) {
    window.location.replace(withBasePath('/login'));
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body: requestBody, authRedirect, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  for (const [key, value] of Object.entries(getAuthHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  let body: BodyInit | undefined;

  if (requestBody !== undefined) {
    headers.set('content-type', headers.get('content-type') || 'application/json');
    body = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
  }

  const response = await apiFetch(path, { ...requestOptions, headers, body }, { authRedirect });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => undefined)
    : await response.text().catch(() => undefined);

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  config: { authRedirect?: boolean } = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  for (const [key, value] of Object.entries(getAuthHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(withBasePath(normalizedPath), {
    ...options,
    credentials: options.credentials || 'same-origin',
    headers,
  });

  if (response.status === 401) {
    handleUnauthorized(config.authRedirect !== false);
  }

  return response;
}
