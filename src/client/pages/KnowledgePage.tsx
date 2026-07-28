'use client';

import type { MouseEvent } from 'react';
import Link from '@/lib/navigation/client';
import { useRouter } from '@/lib/navigation/client';
import { ArrowLeft, ArrowRight, BookOpen, NotebookTabs } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import UserMenu from '@/components/UserMenu';
import {
  DataCard,
  DataCardDescription,
  DataCardHeader,
  DataCardMeta,
  DataCardTitle,
} from '@/components/ui/data-card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';

function KnowledgePageContent() {
  const router = useRouter();
  const dockWorkspace = useDashboardDockWorkspace();
  useDocumentTitle('知识管理');
  const { isDashboardShell } = useDashboardShellHeader({
    title: 'Resources',
    subtitle: '进入 Knowledge Library 管理 RAG 数据；全局 Notebook 作为关联资料入口保留。',
  }, []);

  const openGlobalNotebook = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!dockWorkspace) return;
    event.preventDefault();
    const search = 'notebook=1&notebookScope=global&returnTo=%2Fknowledge';
    dockWorkspace.openTab({
      id: 'notebook:global:root',
      title: '全局 Notebook',
      kind: 'notebook',
      search,
    });
    const params = new URLSearchParams();
    params.set('route', `/notebook?${search}`);
    router.push(`/dashboard?${params.toString()}`);
  };

  const openKnowledgeLibrary = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!dockWorkspace) return;
    event.preventDefault();
    dockWorkspace.openTab({
      id: 'knowledge-library',
      title: '知识库',
      kind: 'knowledge-library',
    });
    const params = new URLSearchParams();
    params.set('route', '/knowledge/library');
    router.push(`/dashboard?${params.toString()}`);
  };

  return (
    <div className={`${isDashboardShell ? 'min-h-0' : 'min-h-screen'} bg-background text-foreground`}>
      {!isDashboardShell ? (
        <header className="border-b">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                <ArrowLeft className="h-4 w-4" />
                返回
              </Link>
              <div>
                <h1 className="text-2xl font-semibold">Resources</h1>
                <p className="mt-1 text-sm text-muted-foreground">进入 Knowledge Library 管理 RAG 数据；全局 Notebook 作为关联资料入口保留。</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>
      ) : null}

      <main className={`mx-auto max-w-6xl px-6 ${isDashboardShell ? 'py-6' : 'py-8'}`}>
        <div className="overflow-hidden rounded-lg border bg-card">
          <PageHeader
            title="Resource Library"
            subtitle="Knowledge Library 是资源管理主入口；Notebook deep link 保持可用，用于整理共享资料。"
            status={<StatusPill tone="accent">Resources</StatusPill>}
          />
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Link href="/knowledge/library" onClick={openKnowledgeLibrary} className="group block">
              <DataCard className="h-full cursor-pointer p-5">
                <DataCardHeader>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg border bg-accent text-accent-foreground">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <DataCardTitle className="text-base">Knowledge Library</DataCardTitle>
                      <DataCardDescription>管理知识库、schema、data、sources、search、jobs 和 RAG API。</DataCardDescription>
                    </div>
                  </div>
                  <StatusPill tone="success">主入口</StatusPill>
                </DataCardHeader>
                <DataCardMeta>
                  <span>KB collections</span>
                  <span>Vector search</span>
                  <span>Import/export</span>
                </DataCardMeta>
                <div className="mt-5 flex items-center gap-2 text-sm font-medium">
                  <span>打开 Library</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </DataCard>
            </Link>
            <Link href="/notebook?notebook=1&notebookScope=global&returnTo=%2Fknowledge" onClick={openGlobalNotebook} className="group block">
              <DataCard className="h-full cursor-pointer p-5">
                <DataCardHeader>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg border bg-muted/40 text-foreground">
                      <NotebookTabs className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <DataCardTitle>全局 Notebook</DataCardTitle>
                      <DataCardDescription>共享笔记与资料整理入口。</DataCardDescription>
                    </div>
                  </div>
                  <StatusPill tone="neutral">Deep link</StatusPill>
                </DataCardHeader>
                <div className="mt-5 flex items-center gap-2 text-sm font-medium">
                  <span>打开 Notebook</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </DataCard>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <AuthGuard>
      <KnowledgePageContent />
    </AuthGuard>
  );
}
