import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/ai-integration/**/*.test.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
    fileParallelism: false,
  },
});
