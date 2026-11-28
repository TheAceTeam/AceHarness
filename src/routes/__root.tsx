import type { ReactNode } from 'react';
import 'material-symbols/outlined.css';
import 'dockview-react/dist/styles/dockview.css';
import '../styles/globals.css';
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Copy, Home, RefreshCw, ServerCrash, WifiOff } from 'lucide-react';
import { Button } from '../components/ui/button';
import { RobotLogo } from '../components/brand/RobotLogo';
import { AceQueryProvider } from '../client/query/query-client';
import { ThemeProvider } from '../components/theme-provider';
import { ToastProvider } from '../components/ui/toast';
import { ChatProvider } from '../contexts/ChatContext';
import ChatModalWrapper from '../components/ChatModalWrapper';
import OnboardingPortal from '../components/onboarding/OnboardingPortal';

export const Route = createRootRoute({
  head: () => ({
    links: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico?v=crystal-deer' }],
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
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
});

function RootError({ error, reset }: ErrorComponentProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const reduceMotion = useReducedMotion();
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  const details = error instanceof Error ? error.stack || error.message : message;

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setDetailsOpen(true);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8 text-foreground sm:px-6">
      <section className="w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        <header className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-7">
          <RobotLogo size={32} />
          <div className="min-w-0">
            <p className="text-sm font-semibold">ACEHarness</p>
            <p className="text-xs text-muted-foreground">工作台运行状态</p>
          </div>
        </header>
        <div className="grid gap-8 px-5 py-7 sm:px-8 sm:py-9 md:grid-cols-[minmax(0,1fr)_210px] md:items-center">
          <div>
            <motion.div
              role="img"
              aria-label="页面发生错误"
              className="group mb-5 flex h-14 items-center"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.3 }}
              whileHover={reduceMotion ? undefined : 'hover'}
            >
              <motion.span variants={{ hover: { x: -5, rotate: -8, y: -2 } }} className="relative z-10 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm">
                <WifiOff className="h-4 w-4" aria-hidden="true" />
              </motion.span>
              <motion.span variants={{ hover: { y: -6, scale: 1.08 } }} className="relative z-20 -ml-2 flex h-12 w-12 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive shadow-sm">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </motion.span>
              <motion.span variants={{ hover: { x: 5, rotate: 8, y: -2 } }} className="relative z-10 -ml-2 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm">
                <ServerCrash className="h-4 w-4" aria-hidden="true" />
              </motion.span>
            </motion.div>
            <p className="text-sm font-medium text-destructive">页面遇到问题</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">暂时无法显示这个页面</h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              当前页面发生了意外错误。你可以重新加载；如果仍无法恢复，请复制错误详情并交给维护人员排查。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={() => { reset(); window.location.reload(); }}>
                <RefreshCw className="mr-2 h-4 w-4" />重新加载页面
              </Button>
              <Button variant="outline" onClick={() => { reset(); window.history.back(); }}>
                <ArrowLeft className="mr-2 h-4 w-4" />返回上一页
              </Button>
            </div>
          </div>
          <aside className="border-t border-border pt-5 md:border-l md:border-t-0 md:py-2 md:pl-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">你可以</p>
            <div className="mt-3 space-y-3 text-sm">
              <p className="leading-5">重新加载以恢复当前页面。</p>
              <p className="leading-5">回到工作台继续使用其他功能。</p>
              <Button className="mt-1 w-full justify-start" variant="ghost" onClick={() => { window.location.assign('/dashboard'); }}>
                <Home className="mr-2 h-4 w-4" />打开工作台首页
              </Button>
            </div>
          </aside>
        </div>
        <div className="border-t border-border bg-muted/20 px-5 py-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">需要进一步排查？</h2>
              <p className="mt-1 text-xs text-muted-foreground">错误信息和调用位置仅在展开后显示。</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyDetails()}>
                {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {copied ? '已复制' : '复制错误详情'}
              </Button>
              <Button variant="ghost" size="sm" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
                {detailsOpen ? '收起' : '展开'}
                <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
              </Button>
            </div>
          </div>
          {detailsOpen ? (
            <div className="mt-4 space-y-2">
              <p className="break-words rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-5">{message}</p>
              {details !== message ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 text-muted-foreground">{details}</pre> : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function RootComponent() {
  return (
    <RootDocument>
      <AceQueryProvider>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ToastProvider>
            <ChatProvider>
              <Outlet />
              <ChatModalWrapper />
              <OnboardingPortal />
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
