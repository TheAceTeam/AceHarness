'use client';

import Link from 'next/link';
import { ArrowLeft, BookOpenText } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import UserMenu from '@/components/UserMenu';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

function KnowledgeLibraryPageContent() {
  useDocumentTitle('知识库');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/knowledge" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <div>
              <h1 className="text-2xl font-semibold">知识库</h1>
              <p className="mt-1 text-sm text-muted-foreground">这里将用于整理团队沉淀的知识内容与结构化资料。</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border bg-muted/20 px-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-background">
            <BookOpenText className="h-8 w-8" />
          </div>
          <h2 className="mt-6 text-xl font-semibold">知识库建设中</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            这里先保留为占位页。后续可以在这里接入知识条目、目录浏览、搜索和资料沉淀能力。
          </p>
        </section>
      </main>
    </div>
  );
}

export default function KnowledgeLibraryPage() {
  return (
    <AuthGuard>
      <KnowledgeLibraryPageContent />
    </AuthGuard>
  );
}
