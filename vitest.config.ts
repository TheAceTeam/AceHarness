import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cangjielang/napi-cj': path.resolve(__dirname, 'packages/napi-cj/src'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // Test files mutate process.env and module mocks; separate worker
    // processes keep those file-local fixtures from racing while preserving
    // file-level parallelism.
    pool: 'forks',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/ai-integration/**', 'node_modules', '.next', 'dist', 'dist-build'],
    setupFiles: ['tests/setup/component-test-setup.ts'],
    testTimeout: 30000,
  },
});
