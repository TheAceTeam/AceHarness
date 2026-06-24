'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, NotebookTabs } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import { workspaceApi, type NotebookScope } from '@/lib/core/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
  createdAt: number;
}

export function NotebookPageContent({
  embedded = false,
  embeddedSearch = '',
}: {
  embedded?: boolean;
  embeddedSearch?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveSearchParams = useMemo(
    () => new URLSearchParams(embedded ? embeddedSearch : searchParams.toString()),
    [embedded, embeddedSearch, searchParams]
  );
  const [user, setUser] = useState<UserInfo | null>(null);
  const scope: NotebookScope = effectiveSearchParams.get('notebookScope') === 'personal' ? 'personal' : 'global';
  const returnTo = effectiveSearchParams.get('returnTo') || '/dashboard';
  const [shareToken, setShareToken] = useState<string | undefined>(undefined);
  const [permission, setPermission] = useState<'read' | 'write'>('write');
  const [open, setOpen] = useState(true);
  const pageTitle = scope === 'global' ? '全局 Notebook' : 'Cangjie Notebook';

  useDocumentTitle(embedded ? null : pageTitle);
  useDashboardShellHeader({
    title: pageTitle,
    subtitle: scope === 'global' ? '团队共享 Notebook' : '个人 Notebook',
  }, [pageTitle, scope]);

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
    const share = effectiveSearchParams.get('notebookShare') || '';
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
        const file = effectiveSearchParams.get('notebookFile');
        if (!file && !embedded) {
          const params = new URLSearchParams(effectiveSearchParams.toString());
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
  }, [effectiveSearchParams, embedded, router]);

  if (!user) {
    return <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">加载 Notebook...</div>;
  }

  return (
    <div className={`${embedded ? 'h-full' : 'h-dvh'} bg-background text-foreground flex flex-col overflow-hidden`}>
      {!embedded ? (
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
              <h1 className="truncate text-xl font-semibold">{pageTitle}</h1>
            </div>
          </div>
        </div>
      </header>
      ) : null}
      <div className="flex-1 min-h-0 overflow-hidden">
        <WorkspaceEditor
          open={open}
          onOpenChange={(next) => {
            if (embedded) return;
            setOpen(next);
            if (!next) router.push(returnTo);
          }}
          workspacePath={user.personalDir || '/'}
          mode="notebook"
          title={pageTitle}
          presentation="page"
          notebookScope={scope}
          notebookShareToken={shareToken}
          notebookPermission={permission}
        />
      </div>
    </div>
  );
}

export default function NotebookPage(props: {
  embedded?: boolean;
  embeddedSearch?: string;
} = {}) {
  return (
    <AuthGuard>
      <NotebookPageContent {...props} />
    </AuthGuard>
  );
}
