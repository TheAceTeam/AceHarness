'use client';

import dynamic from '@/lib/navigation/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/lib/navigation/client';
import { logoutCurrentUser, useCurrentUserQuery } from '@/client/query/auth';
import { useUsersQuery } from '@/client/query/users';
import { queryKeys } from '@/client/query/query-keys';
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

const AccountContent = dynamic(() => import('@/client/pages/AccountPage').then((m) => m.AccountContent), { ssr: false });

export default function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUserQuery();
  const menuUser = user ?? currentUser.data ?? null;
  const dockWorkspace = useDashboardDockWorkspace();
  const [accountOpen, setAccountOpen] = useState(false);
  const usersQuery = useUsersQuery({ enabled: menuUser?.role === 'admin' });
  const pendingUserCount = useMemo(() => {
    if (menuUser?.role !== 'admin') return 0;
    const users = Array.isArray(usersQuery.data?.users) ? usersQuery.data.users : [];
    return users.filter((item) => item.status === 'pending').length;
  }, [menuUser?.role, usersQuery.data?.users]);

  useEffect(() => {
    if (menuUser?.role !== 'admin') {
      return;
    }

    const handlePendingCountChanged = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users() });
    };

    window.addEventListener('aceharness:pending-users-changed', handlePendingCountChanged);

    return () => {
      window.removeEventListener('aceharness:pending-users-changed', handlePendingCountChanged);
    };
  }, [menuUser?.role, queryClient]);

  const handleLogout = async () => {
    await logoutCurrentUser(queryClient);
    router.push('/login');
  };

  if (!menuUser) return null;

  const initials = menuUser.username?.charAt(0)?.toUpperCase() || '?';
  const hasPendingUsers = menuUser.role === 'admin' && pendingUserCount > 0;
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
                avatar={menuUser.avatar}
                seed={menuUser.username}
                category="user-default"
                alt={menuUser.username}
                fallback={initials}
                className="h-8 w-8"
                fallbackClassName="text-xs bg-primary/20 text-primary"
              />
              {hasPendingUsers && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-destructive" />
              )}
            </span>
            <span className="text-sm font-medium hidden sm:inline">{menuUser.username}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{menuUser.username}</p>
            <p className="text-xs text-muted-foreground">{menuUser.email}</p>
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
          {menuUser.role === 'admin' && (
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
