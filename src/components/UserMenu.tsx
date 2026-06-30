'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface UserMenuProps {
  user?: {
    username: string;
    email: string;
    role: 'admin' | 'user';
    avatar?: string;
  } | null;
}

const AccountContent = dynamic(() => import('@/app/account/page').then((m) => m.AccountContent), { ssr: false });

export default function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const dockWorkspace = useDashboardDockWorkspace();
  const [pendingUserCount, setPendingUserCount] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    if (user?.role !== 'admin') {
      setPendingUserCount(0);
      return;
    }

    const token = localStorage.getItem('auth-token');
    if (!token) return;

    let cancelled = false;
    const loadPendingUserCount = () => fetch('/api/users', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const users = Array.isArray(data?.users) ? data.users : [];
        setPendingUserCount(users.filter((item: any) => item.status === 'pending').length);
      })
      .catch(() => {
        if (!cancelled) setPendingUserCount(0);
      });

    const handlePendingCountChanged = (event: Event) => {
      const count = (event as CustomEvent<number>).detail;
      if (typeof count === 'number') setPendingUserCount(count);
    };

    loadPendingUserCount();
    window.addEventListener('aceharness:pending-users-changed', handlePendingCountChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('aceharness:pending-users-changed', handlePendingCountChanged);
    };
  }, [user?.role]);

  const handleLogout = async () => {
    const token = localStorage.getItem('auth-token');
    if (token) {
      await fetch('/api/auth/me', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem('auth-token');
    localStorage.removeItem('auth-user');
    router.push('/login');
  };

  if (!user) return null;

  const initials = user.username?.charAt(0)?.toUpperCase() || '?';
  const hasPendingUsers = user.role === 'admin' && pendingUserCount > 0;
  const pushDashboardRoute = (route: string) => {
    const params = new URLSearchParams();
    params.set('route', route);
    router.push(`/dashboard?${params.toString()}`);
  };
  const openNotebook = () => {
    const search = 'notebook=1&notebookScope=personal';
    if (dockWorkspace) {
      dockWorkspace.openTab({
        id: 'notebook:personal:root',
        title: 'Cangjie Notebook',
        kind: 'notebook',
        search,
      });
      pushDashboardRoute(`/notebook?${search}`);
      return;
    }
    router.push('/account?notebook=1&notebookScope=personal');
  };
  const openAccount = () => {
    setAccountOpen(true);
  };
  const openUsers = () => {
    if (dockWorkspace) {
      dockWorkspace.openTab({ id: 'users', title: '用户管理', kind: 'users' });
      return;
    }
    router.push('/users');
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-full hover:opacity-80 transition-opacity focus:outline-none">
            <span className="relative">
              <SpriteAvatar
                avatar={user.avatar}
                seed={user.username}
                category="user-default"
                alt={user.username}
                fallback={initials}
                className="h-8 w-8"
                fallbackClassName="text-xs bg-primary/20 text-primary"
              />
              {hasPendingUsers && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-destructive" />
              )}
            </span>
            <span className="text-sm font-medium hidden sm:inline">{user.username}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.username}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openNotebook}>
            <span className="material-symbols-outlined text-sm mr-2">book_2</span>
            Cangjie Notebook
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openAccount}>
            <span className="material-symbols-outlined text-sm mr-2">person</span>
            账户设置
          </DropdownMenuItem>
          {user.role === 'admin' && (
            <DropdownMenuItem onClick={openUsers} className="gap-2">
              <span className="material-symbols-outlined text-sm">group</span>
              <span className="flex-1">用户管理</span>
              {hasPendingUsers && (
                <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">
                  {pendingUserCount}
                </Badge>
              )}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <span className="material-symbols-outlined text-sm mr-2">logout</span>
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="flex h-[min(860px,calc(100vh-2rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>个人设置</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            <AccountContent embedded registerShellHeader={false} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
