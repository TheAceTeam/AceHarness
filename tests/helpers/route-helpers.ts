import { NextRequest } from 'next/server';
import { expect, vi } from 'vitest';

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  json?: unknown;
  token?: string;
}

export function makeRequest(urlPath: string, options: RequestOptions = {}): NextRequest {
  const url = urlPath.startsWith('http') ? urlPath : `http://localhost${urlPath}`;
  const headers = new Headers(options.headers ?? {});
  let body = options.body;

  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.json);
  }

  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  return new NextRequest(url, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
  });
}

export async function responseJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function assertErrorResponse(response: Response, status: number): Promise<any> {
  expect(response.status).toBe(status);
  const json = await responseJson(response);
  expect(json?.error || json?.message).toBeTruthy();
  return json;
}

export async function assertSuccessResponse(response: Response, expectedStatus = 200): Promise<any> {
  expect(response.status).toBe(expectedStatus);
  const json = await responseJson(response);
  expect(json).toBeTruthy();
  return json;
}

export async function importFresh<T = any>(path: string): Promise<T> {
  vi.resetModules();
  return import(path) as Promise<T>;
}
