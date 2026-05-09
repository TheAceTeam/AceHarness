// Suppress known Turbopack warnings that can't be fixed due to dynamic imports
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk, ...args) => {
  const str = chunk.toString();
  // chat-system-prompt.ts uses dynamic path join - Turbopack can't resolve at build time
  if (str.includes('chat-system-prompt') && str.includes('file pattern')) return true;
  // instrumentation-nodejs.ts dynamic import
  if (str.includes('instrumentation-nodejs') && str.includes('Can\'t resolve')) return true;
  // workflow-manager.ts and state-machine-workflow-manager.ts use dynamic resolve for skills directory
  if (str.includes('workflow-manager') && str.includes('file pattern')) return true;
  if (str.includes('state-machine-workflow-manager') && str.includes('file pattern')) return true;
  // app-paths.ts uses dynamic path join with INSTALL_ROOT - Turbopack can't resolve at build time
  if (str.includes('app-paths') && str.includes('file pattern')) return true;
  return originalStderrWrite(chunk, ...args);
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 开发服务器配置
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right',
  },

  // 抑制开发模式下的 fetch 日志
  logging: {
    fetches: {
      fullUrl: false,
    },
  },

  // 预连接关键资源
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
