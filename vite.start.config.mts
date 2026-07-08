import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rawBase = process.env.BASEURL || process.env.BASE_URL || '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
const rawPort = process.env.ACE_PORT || process.env.PORT;
const devPort = rawPort ? Number.parseInt(rawPort, 10) : undefined;
const devTimeoutMs = Number.parseInt(process.env.VITE_DEV_TIMEOUT_MS || '180000', 10);

export default defineConfig({
  base,
  server: {
    port: Number.isFinite(devPort) ? devPort : undefined,
    strictPort: Number.isFinite(devPort),
    watch: {
      ignored: [
        '**/.tmp-*/**',
        '**/.tmp*/**',
        '**/dist/**',
        '**/dist-build/**',
        '**/.next/**',
        '**/runtime/**',
        '**/messages/**',
        '**/target/**',
      ],
    },
    ws: {
      timeout: Number.isFinite(devTimeoutMs) ? devTimeoutMs : 180000,
    },
    warmup: {
      ssrFiles: [
        './src/start.ts',
        './src/router.tsx',
        './src/routes/__root.tsx',
      ],
      clientFiles: [
        './src/routes/__root.tsx',
      ],
    },
  },
  optimizeDeps: {
    entries: [
      './src/start.ts',
      './src/router.tsx',
      './src/routes/**/*.ts',
      './src/routes/**/*.tsx',
      './src/client/pages/**/*.tsx',
      './src/components/**/*.tsx',
    ],
  },
  ssr: {
    external: [
      '@cangjielang/napi-cj',
      'better-sqlite3',
      'node-ssh-no-cpu-features',
      '@marsaud/smb2',
      'webdav',
      'lancedb',
    ],
  },
  plugins: [
    tanstackStart(),
    react(),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  define: {
    'process.env.NEXT_PUBLIC_BASEURL': JSON.stringify(base === '/' ? '' : base.replace(/\/+$/, '')),
    'import.meta.env.VITE_ACE_BASE_URL': JSON.stringify(base),
  },
});
