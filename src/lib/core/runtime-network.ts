import { DEFAULT_PORT } from '@/lib/core/product-identity';

function parsePort(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return port;
}

export function resolveRuntimePort(env: NodeJS.ProcessEnv, savedPort?: number): number {
  const csiPort = parsePort(env.CSIHARNESS_PORT, 'CSIHARNESS_PORT');
  if (csiPort !== undefined) return csiPort;
  const genericPort = parsePort(env.PORT, 'PORT');
  if (genericPort !== undefined) return genericPort;
  if (Number.isInteger(savedPort) && savedPort! >= 1 && savedPort! <= 65535) return savedPort!;
  return DEFAULT_PORT;
}
