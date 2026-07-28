import { describe, expect, test, vi } from 'vitest';
import {
  withMemoryV2ImmediateTransaction,
  type MemoryV2Database,
} from '@/lib/memory-v2/database';

describe('withMemoryV2ImmediateTransaction', () => {
  test('preserves the original failure when rollback also fails', () => {
    const originalError = new Error('write failed');
    const exec = vi.fn((statement: string) => {
      if (statement === 'ROLLBACK') throw new Error('rollback failed');
    });
    const db = { exec } as unknown as MemoryV2Database;

    let caught: unknown;
    try {
      withMemoryV2ImmediateTransaction(db, () => {
        throw originalError;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(originalError);
    expect(exec).toHaveBeenNthCalledWith(1, 'BEGIN IMMEDIATE');
    expect(exec).toHaveBeenNthCalledWith(2, 'ROLLBACK');
  });
});
