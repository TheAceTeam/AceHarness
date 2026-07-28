import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { createLogger, defineConfig } from 'vite';

const rawBase = process.env.BASEURL || process.env.BASE_URL || '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
const rawPort = process.env.CSIHARNESS_PORT || process.env.PORT;
const devPort = rawPort ? Number.parseInt(rawPort, 10) : undefined;
const devTimeoutMs = Number.parseInt(process.env.VITE_DEV_TIMEOUT_MS || '180000', 10);
const logger = createLogger();

function shouldMuteBuildWarning(message: string): boolean {
  return [
    'has been externalized for browser compatibility',
    'INEFFECTIVE_DYNAMIC_IMPORT',
    'Use of direct `eval` function is strongly discouraged',
    'Some chunks are larger than',
    'PLUGIN_TIMINGS',
  ].some((pattern) => message.includes(pattern));
}

const customLogger = {
  ...logger,
  warn(message: string, options?: Parameters<typeof logger.warn>[1]) {
    if (shouldMuteBuildWarning(message)) return;
    logger.warn(message, options);
  },
  warnOnce(message: string, options?: Parameters<typeof logger.warnOnce>[1]) {
    if (shouldMuteBuildWarning(message)) return;
    logger.warnOnce(message, options);
  },
};

export default defineConfig({
  base,
  customLogger,
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
  build: {
    chunkSizeWarningLimit: 10_000,
    rolldownOptions: {
      checks: {
        eval: false,
        invalidAnnotation: false,
        pluginTimings: false,
      },
      onwarn(warning, defaultHandler) {
        const code = typeof warning.code === 'string' ? warning.code : '';
        const message = typeof warning.message === 'string' ? warning.message : String(warning);
        if (code === 'INEFFECTIVE_DYNAMIC_IMPORT' || shouldMuteBuildWarning(message)) return;
        defaultHandler(warning);
      },
    } as any,
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
