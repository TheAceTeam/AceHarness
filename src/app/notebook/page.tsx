'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, NotebookTabs } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { ThemeToggle } from '@/components/theme-toggle';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import { workspaceApi, type NotebookScope } from '@/lib/core/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
  createdAt: number;
}

function NotebookPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<UserInfo | null>(null);
  const scope: NotebookScope = 'global';
  const returnTo = searchParams.get('returnTo') || '/dashboard';
  const [shareToken, setShareToken] = useState<string | undefined>(undefined);
  const [permission, setPermission] = useState<'read' | 'write'>('write');
  const [open, setOpen] = useState(true);

  useDocumentTitle('Cangjie Notebook');

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
    fetch('/api/auth/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.json())
      .then((data) => setUser(data.user || null))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const share = searchParams.get('notebookShare') || '';
    const scopeParam = searchParams.get('notebookScope');
    if (scopeParam !== 'global') {
      const params = new URLSearchParams(searchParams.toString());
      params.set('notebook', '1');
      params.set('notebookScope', 'global');
      router.replace(`/notebook?${params.toString()}`);
      return;
    }
    if (!share) {
      setShareToken(undefined);
      setPermission('write');
      return;
    }
    let cancelled = false;
    workspaceApi.resolveNotebookShare(share)
      .then((resolved) => {
        if (cancelled) return;
        if (resolved.scope !== 'global') {
          setShareToken(undefined);
          setPermission('write');
          return;
        }
        setShareToken(share);
        setPermission(resolved.permission);
        const file = searchParams.get('notebookFile');
        if (!file) {
          const params = new URLSearchParams(searchParams.toString());
          params.set('notebook', '1');
          params.set('notebookScope', resolved.scope);
          params.set('notebookFile', resolved.path);
          params.set('notebookShare', share);
          params.set('notebookPermission', resolved.permission);
          router.replace(`/notebook?${params.toString()}`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setShareToken(undefined);
        setPermission('write');
      });
    return () => { cancelled = true; };
  }, [router, searchParams]);

  if (!user) {
    return <div className="h-dvh flex items-center justify-center text-sm text-muted-foreground">加载 Notebook...</div>;
  }

  return (
    <div className="h-dvh bg-background text-foreground flex flex-col overflow-hidden">
      <header className="border-b shrink-0">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link
              href={returnTo}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回</span>
            </Link>
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted/40 text-foreground shrink-0">
                <NotebookTabs className="h-5 w-5" />
              </div>
              <h1 className="truncate text-xl font-semibold">Cangjie Notebook</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">
        <WorkspaceEditor
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) router.push(returnTo);
          }}
          workspacePath={user.personalDir || '/'}
          mode="notebook"
          title="Cangjie Notebook"
          presentation="page"
          notebookScope={scope}
          notebookShareToken={shareToken}
          notebookPermission={permission}
        />
      </div>
    </div>
  );
}

export default function NotebookPage() {
  return (
    <AuthGuard>
      <NotebookPageContent />
    </AuthGuard>
  );
}
