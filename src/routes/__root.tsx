import type { ReactNode } from 'react';
import 'material-symbols/outlined.css';
import 'dockview-react/dist/styles/dockview.css';
import '../styles/globals.css';
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router';
import { AceQueryProvider } from '../client/query/query-client';
import { ThemeProvider } from '../components/theme-provider';
import { ToastProvider } from '../components/ui/toast';
import { ChatProvider } from '../contexts/ChatContext';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'ACEHarness' },
      {
        name: 'description',
        content: 'ACEHarness - Agent Centric Engineering Harness',
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: RootNotFound,
});

function RootComponent() {
  return (
    <RootDocument>
      <AceQueryProvider>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ToastProvider>
            <ChatProvider>
              <Outlet />
            </ChatProvider>
          </ToastProvider>
        </ThemeProvider>
      </AceQueryProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const locale = typeof process !== 'undefined' && process.env.ACE_LOCALE === 'en' ? 'en' : 'zh-CN';

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootNotFound() {
  return (
    <main className="min-h-screen bg-[#F4F4F1] px-6 py-10 text-[#151515] dark:bg-[#0D0E14] dark:text-[#F7F7F4]">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl items-center justify-center">
        <div className="w-full rounded-xl border border-[#E3E3DF] bg-white p-8 shadow-none dark:border-white/10 dark:bg-[#191A20]">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-[#E3E3DF] bg-[#EEE7FF] text-[#8B5CF6] dark:border-white/10 dark:bg-[#2A2238]">
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>explore</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-normal">页面暂时没有可用内容</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#8A8A84] dark:text-white/60">
            当前地址没有匹配到已注册页面。可以返回工作台继续使用已打开的对话、工作流和管理页面。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/dashboard"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[#E3E3DF] bg-white px-4 text-sm font-medium text-[#151515] transition-colors hover:bg-[#F7F7F4] dark:border-white/10 dark:bg-[#191A20] dark:text-[#F7F7F4] dark:hover:bg-white/5"
            >
              返回工作台
            </a>
            <a
              href="/"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-[#E3E3DF] bg-white px-4 text-sm font-medium text-[#151515] transition-colors hover:bg-[#F7F7F4] dark:border-white/10 dark:bg-[#191A20] dark:text-[#F7F7F4] dark:hover:bg-white/5"
            >
              返回首页
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
