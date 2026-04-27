'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import AvatarPicker from '@/components/AvatarPicker';
import AuthGuard from '@/components/AuthGuard';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { ArrowLeft, Plus, Search, MoreHorizontal } from 'lucide-react';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
  createdAt: number;
  createdBy?: string;
}

function UsersContent() {
  const router = useRouter();
  useDocumentTitle('用户管理');
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);
  const [form, setForm] = useState({ username: '', email: '', password: '', question: '', answer: '', role: 'user' as 'admin' | 'user', personalDir: '', avatar: '' });
  const [formError, setFormError] = useState('');

  // Reset password dialog
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState('');
  const [resetPwd, setResetPwd] = useState('');
  const [resetError, setResetError] = useState('');
  const { confirm, dialogProps } = useConfirmDialog();

  const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };

  const loadUsers = async () => {
    try {
      const res = await fetch('/api/users', { headers });
      if (res.status === 403) { router.push('/'); return; }
      const data = await res.json();
      setUsers(data.users || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    fetch('/api/auth/me', { headers }).then(r => r.json()).then(d => {
      setCurrentUser(d.user);
      if (d.user?.role !== 'admin') router.push('/');
    });
    loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [users, searchQuery]);

  const openCreate = () => {
    setEditingUser(null);
    setForm({ username: '', email: '', password: '', question: '', answer: '', role: 'user', personalDir: '', avatar: '' });
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (user: UserInfo) => {
    setEditingUser(user);
    setForm({ username: user.username, email: user.email, password: '', question: '', answer: '', role: user.role, personalDir: user.personalDir, avatar: user.avatar || '' });
    setFormError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setFormError('');
    if (editingUser) {
      // Update
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PUT', headers: jsonHeaders,
        body: JSON.stringify({ username: form.username, email: form.email, role: form.role, personalDir: form.personalDir, avatar: form.avatar }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error); return; }
    } else {
      // Create
      if (!form.username || !form.email || !form.password || !form.question || !form.answer) {
        setFormError('所有字段不能为空'); return;
      }
      const res = await fetch('/api/users', {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error); return; }
    }
    setDialogOpen(false);
    loadUsers();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: '删除用户',
      description: '确定要删除该用户吗？',
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    await fetch(`/api/users/${id}`, { method: 'DELETE', headers });
    loadUsers();
  };

  const handleResetPassword = async () => {
    setResetError('');
    if (resetPwd.length < 6) { setResetError('密码至少6个字符'); return; }
    const res = await fetch(`/api/users/${resetUserId}`, {
      method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ resetPassword: resetPwd }),
    });
    const data = await res.json();
    if (!res.ok) { setResetError(data.error); return; }
    setResetOpen(false); setResetPwd('');
  };

  /* RENDER */
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" />返回首页</Link>
            </Button>
            <div className="h-6 w-px bg-border" />
            <div>
              <h1 className="text-2xl font-bold">用户管理</h1>
              <p className="text-xs text-muted-foreground">{users.length} 个用户</p>
            </div>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />新建用户</Button>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        <div className="mb-6 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="搜索用户名或邮箱..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10" />
        </div>

        {loading ? (
          <p className="text-muted-foreground text-center py-12">加载中...</p>
        ) : (
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">头像</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>个人目录</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="w-12">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map(user => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Avatar className="h-8 w-8">
                        {user.avatar ? <AvatarImage src={`/avatar/${user.avatar}`} alt={user.username} /> : null}
                        <AvatarFallback className="text-xs">{user.username.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                        {user.role === 'admin' ? '管理员' : '用户'}
                      </Badge>
                    </TableCell>
                    <TableCell><code className="text-xs">{user.personalDir || '-'}</code></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm"><MoreHorizontal className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(user)}>编辑</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setResetUserId(user.id); setResetPwd(''); setResetError(''); setResetOpen(true); }}>重置密码</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(user.id)} disabled={user.id === currentUser?.id}>删除</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredUsers.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">暂无用户</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingUser ? '编辑用户' : '新建用户'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="用户名" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
            <Input placeholder="邮箱" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            {!editingUser && (
              <>
                <Input placeholder="密码（至少6位）" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                <Input placeholder="密保问题" value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))} />
                <Input placeholder="密保答案" value={form.answer} onChange={e => setForm(f => ({ ...f, answer: e.target.value }))} />
              </>
            )}
            <div className="flex items-center gap-2">
              <label className="text-sm">角色：</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'user' }))} className="rounded-md border bg-background px-3 py-1.5 text-sm">
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <Input placeholder="个人目录（可选）" value={form.personalDir} onChange={e => setForm(f => ({ ...f, personalDir: e.target.value }))} />
            <WorkspaceDirectoryPicker
              workspaceRoot="/"
              value={form.personalDir}
              onChange={(path) => setForm((f) => ({ ...f, personalDir: path }))}
            />
            <div>
              <label className="text-sm mb-2 block">选择头像：</label>
              <AvatarPicker value={form.avatar} onChange={avatar => setForm(f => ({ ...f, avatar }))} />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave}>{editingUser ? '保存' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>重置密码</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="password" placeholder="新密码（至少6位）" value={resetPwd} onChange={e => setResetPwd(e.target.value)} />
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>取消</Button>
            <Button onClick={handleResetPassword}>确认重置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}

export default function UsersPage() {
  return <AuthGuard><UsersContent /></AuthGuard>;
}
