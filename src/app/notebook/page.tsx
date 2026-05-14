'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import { workspaceApi, type NotebookScope } from '@/lib/core/api';

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
  const [shareToken, setShareToken] = useState<string | undefined>(undefined);
  const [permission, setPermission] = useState<'read' | 'write'>('write');
  const [open, setOpen] = useState(true);

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
    return <div className="h-screen flex items-center justify-center text-sm text-muted-foreground">加载 Notebook...</div>;
  }

  return (
    <WorkspaceEditor
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) router.push('/dashboard');
      }}
      workspacePath={user.personalDir || '/'}
      mode="notebook"
      title="Notebook"
      notebookScope={scope}
      notebookShareToken={shareToken}
      notebookPermission={permission}
    />
  );
}

export default function NotebookPage() {
  return (
    <AuthGuard>
      <NotebookPageContent />
    </AuthGuard>
  );
}
