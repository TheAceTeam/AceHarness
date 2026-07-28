import type { RedactedRuntimeBindingDto, RuntimeBinding } from '../contracts';

export const REDACTED_VALUE = '[REDACTED]';

const SECRET_KEY_PATTERN = /(?:secret|token|password|passwd|pwd|api[_-]?key|auth|credential|private[_-]?key|access[_-]?key|refresh[_-]?token|session[_-]?id)/i;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g;
const ASSIGNMENT_SECRET_PATTERN = /\b([A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|AUTH|CREDENTIAL)[A-Za-z0-9_.-]*)\s*=\s*([^\s"'`]+)/gi;
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

export interface RedactionOptions {
  secrets?: readonly string[];
  replacement?: string;
  maxDepth?: number;
}

export interface RedactionResult<T> {
  value: T;
  redacted: boolean;
}

function replacement(options?: RedactionOptions): string {
  return options?.replacement ?? REDACTED_VALUE;
}

function shouldRedactKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function redactKnownSecrets(text: string, options?: RedactionOptions): RedactionResult<string> {
  let redacted = false;
  let output = text;
  const mark = replacement(options);

  for (const secret of options?.secrets ?? []) {
    if (!secret) {
      continue;
    }
    const next = output.split(secret).join(mark);
    if (next !== output) {
      redacted = true;
      output = next;
    }
  }

  const withPatterns = output
    .replace(BEARER_TOKEN_PATTERN, () => {
      redacted = true;
      return `Bearer ${mark}`;
    })
    .replace(ASSIGNMENT_SECRET_PATTERN, (_match, key) => {
      redacted = true;
      return `${key}=${mark}`;
    })
    .replace(URL_CREDENTIAL_PATTERN, (_match, scheme, user) => {
      redacted = true;
      return `${scheme}${user}:${mark}@`;
    });

  return { value: withPatterns, redacted };
}

export function redactText(value: string, options?: RedactionOptions): RedactionResult<string> {
  return redactKnownSecrets(value, options);
}

export function redactRecord<T>(value: T, options: RedactionOptions = {}): RedactionResult<T> {
  const seen = new WeakSet<object>();
  let redacted = false;
  const maxDepth = options.maxDepth ?? 12;
  const mark = replacement(options);

  function visit(input: unknown, depth: number, keyHint?: string): unknown {
    if (input == null) {
      return input;
    }

    if (typeof input === 'string') {
      if (keyHint && shouldRedactKey(keyHint)) {
        redacted = true;
        return mark;
      }
      const result = redactKnownSecrets(input, options);
      redacted = redacted || result.redacted;
      return result.value;
    }

    if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
      if (keyHint && shouldRedactKey(keyHint)) {
        redacted = true;
        return mark;
      }
      return input;
    }

    if (typeof input !== 'object') {
      return input;
    }

    if (depth >= maxDepth) {
      return '[MaxDepth]';
    }

    if (seen.has(input)) {
      return '[Circular]';
    }
    seen.add(input);

    if (Array.isArray(input)) {
      return input.map((item) => visit(item, depth + 1));
    }

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input)) {
      if (shouldRedactKey(key)) {
        output[key] = mark;
        redacted = true;
      } else {
        output[key] = visit(nested, depth + 1, key);
      }
    }
    return output;
  }

  return {
    value: visit(value, 0) as T,
    redacted,
  };
}

export function redactRuntimeBinding(binding: RuntimeBinding): RedactedRuntimeBindingDto {
  return {
    id: binding.id,
    runtimeSessionId: binding.runtimeSessionId,
    runtime: binding.runtime,
    role: binding.role,
    generation: binding.generation,
    externalIdsRedacted: true,
    rawRedacted: true,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

export function redactDiagnosticPayload<T>(payload: T, options?: RedactionOptions): RedactionResult<T> {
  return redactRecord(payload, options);
}

