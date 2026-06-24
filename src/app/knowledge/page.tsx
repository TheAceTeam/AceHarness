'use client';

import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, NotebookTabs } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import UserMenu from '@/components/UserMenu';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';

function EntryCard({
  href,
  title,
  description,
  icon,
  badge,
  onClick,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  badge?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="group flex min-h-[260px] flex-col justify-between rounded-lg border bg-background p-8 transition-colors hover:bg-accent/30"
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border bg-muted/40 text-foreground">
            {icon}
          </div>
          {badge ? (
            <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">{badge}</span>
          ) : null}
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-8 flex items-center gap-2 text-sm text-foreground">
        <span>进入</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function KnowledgePageContent() {
  const router = useRouter();
  const dockWorkspace = useDashboardDockWorkspace();
  useDocumentTitle('知识管理');
  const { isDashboardShell } = useDashboardShellHeader({
    title: '知识管理',
    subtitle: '进入 ACEHarness 原生 RAG 知识库，或继续使用全局 Notebook。',
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
                <h1 className="text-2xl font-semibold">知识管理</h1>
                <p className="mt-1 text-sm text-muted-foreground">进入 ACEHarness 原生 RAG 知识库，或继续使用全局 Notebook。</p>
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
        <div className="grid gap-6 lg:grid-cols-2">
          <EntryCard
            href="/knowledge/library"
            title="知识库"
            description="进入 ACEHarness 原生 RAG 容器，管理知识库、导入外部 RAG 内容、预览 chunks 并测试检索。"
            icon={<BookOpen className="h-7 w-7" />}
            badge="RAG"
            onClick={openKnowledgeLibrary}
          />
          <EntryCard
            href="/notebook?notebook=1&notebookScope=global&returnTo=%2Fknowledge"
            title="全局 Notebook"
            description="进入团队共享 Notebook，继续编辑、整理和协作处理现有内容。"
            icon={<NotebookTabs className="h-7 w-7" />}
            onClick={openGlobalNotebook}
          />
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
