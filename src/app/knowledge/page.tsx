'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen, NotebookTabs } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import UserMenu from '@/components/UserMenu';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

function EntryCard({
  href,
  title,
  description,
  icon,
  badge,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  badge?: string;
}) {
  return (
    <Link
      href={href}
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
  useDocumentTitle('知识');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <div>
              <h1 className="text-2xl font-semibold">知识</h1>
              <p className="mt-1 text-sm text-muted-foreground">在这里查看团队知识内容，或继续进入共享 Notebook 处理资料。</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <EntryCard
            href="/knowledge/library"
            title="知识库"
            description="集中查看沉淀后的资料、说明和规范。当前版本先提供占位入口。"
            icon={<BookOpen className="h-7 w-7" />}
            badge="建设中"
          />
          <EntryCard
            href="/notebook?notebook=1&notebookScope=global&returnTo=%2Fknowledge"
            title="全局 Notebook"
            description="进入团队共享 Notebook，继续编辑、整理和协作处理现有内容。"
            icon={<NotebookTabs className="h-7 w-7" />}
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
