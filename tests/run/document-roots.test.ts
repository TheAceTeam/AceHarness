import { describe, expect, test } from 'vitest';
import {
  isSafeDocumentRename,
  isSafeRunDocumentId,
  normalizeDocumentRelativePath,
} from '@/lib/run/document-roots';

describe('run document roots', () => {
  test('normalizes listed nested document paths to one POSIX identity', () => {
    expect(normalizeDocumentRelativePath('nested\\plan.md')).toBe('nested/plan.md');
    expect(normalizeDocumentRelativePath('nested/plan.md')).toBe('nested/plan.md');
  });

  test('rejects traversal and absolute document references', () => {
    expect(normalizeDocumentRelativePath('../plan.md')).toBeNull();
    expect(normalizeDocumentRelativePath('nested/../plan.md')).toBeNull();
    expect(normalizeDocumentRelativePath('/workspace/plan.md')).toBeNull();
    expect(normalizeDocumentRelativePath('C:\\workspace\\plan.md')).toBeNull();
  });

  test('only permits safe run IDs and rename basenames', () => {
    expect(isSafeRunDocumentId('run-123')).toBe(true);
    expect(isSafeRunDocumentId('../run-123')).toBe(false);
    expect(isSafeRunDocumentId('run:123')).toBe(false);
    expect(isSafeDocumentRename('review.md')).toBe(true);
    expect(isSafeDocumentRename('../review.md')).toBe(false);
  });
});
