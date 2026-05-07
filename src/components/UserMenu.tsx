'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface UserMenuProps {
  user: {
    username: string;
    email: string;
    role: 'admin' | 'user';
    avatar?: string;
  } | null;
}

export default function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const [pendingUserCount, setPendingUserCount] = useState(0);

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

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full hover:opacity-80 transition-opacity focus:outline-none">
          <span className="relative">
            <Avatar className="h-8 w-8">
              {user.avatar ? (
                <AvatarImage src={`/avatar/${user.avatar}`} alt={user.username} />
              ) : null}
              <AvatarFallback className="text-xs bg-primary/20 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
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
        <DropdownMenuItem onClick={() => router.push('/account')}>
          <span className="material-symbols-outlined text-sm mr-2">person</span>
          账户设置
        </DropdownMenuItem>
        {user.role === 'admin' && (
          <DropdownMenuItem onClick={() => router.push('/users')} className="gap-2">
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
  );
}
