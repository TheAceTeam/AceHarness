export function requestUrl(request: Request): URL {
  return new URL(request.url);
}

export function requestCookies(request: Request) {
  const store = new Map<string, { name: string; value: string }>();
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (!rawName) continue;
    const value = rest.join('=');
    store.set(rawName, { name: rawName, value: decodeURIComponent(value || '') });
  }
  return {
    get: (name: string) => store.get(name),
    getAll: () => Array.from(store.values()),
    has: (name: string) => store.has(name),
  };
}

export function jsonOk<T>(body: T, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function jsonError(error: string, status = 500, detail?: unknown): Response {
  const message = detail == null ? undefined : errorMessage(detail);
  return Response.json(
    message ? { error, message } : { error },
    { status },
  );
}

export async function readJsonBody<T = Record<string, unknown>>(request: Request, fallback: T): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    return fallback;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
