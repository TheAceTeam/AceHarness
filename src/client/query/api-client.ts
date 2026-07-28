import { ApiError } from './query-client';
import { withBasePath } from '../base-url';
import { buildLoginHref, getCurrentAuthReturnTo } from '@/lib/navigation/return-target';

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
  const onLoginPage = window.location.pathname === withBasePath('/login');
  clearAuthSession({ emitEvent: redirect && !onLoginPage });
  if (!redirect) return;
  if (!onLoginPage) {
    window.location.replace(withBasePath(buildLoginHref(getCurrentAuthReturnTo('/'))));
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

  if (response.status === 401 && config.authRedirect !== false) {
    handleUnauthorized(true);
  }

  return response;
}

export function apiUploadWithProgress<T>(
  path: string,
  formData: FormData,
  options: {
    method?: string;
    authRedirect?: boolean;
    onProgress?: (progress: { loaded: number; total: number; percent: number }) => void;
  } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    xhr.open(options.method || 'POST', withBasePath(normalizedPath), true);
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(getAuthHeaders())) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      options.onProgress?.({ loaded: event.loaded, total: event.total, percent });
    };
    xhr.onerror = () => reject(new ApiError('网络错误，上传失败', xhr.status || 0));
    xhr.onabort = () => reject(new ApiError('上传已取消', xhr.status || 0));
    xhr.onload = () => {
      if (xhr.status === 401 && options.authRedirect !== false) {
        handleUnauthorized(true);
      }
      const payload = (() => {
        try {
          return xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          return xhr.responseText;
        }
      })();
      if ((xhr.status < 200 || xhr.status >= 300) && !(payload && typeof payload === 'object' && Array.isArray((payload as any).results))) {
        const message = typeof payload === 'object' && payload && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : `Request failed with status ${xhr.status}`;
        reject(new ApiError(message, xhr.status, payload));
        return;
      }
      resolve(payload as T);
    };
    xhr.send(formData);
  });
}
