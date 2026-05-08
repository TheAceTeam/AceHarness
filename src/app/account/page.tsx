'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import AvatarPicker from '@/components/AvatarPicker';
import AuthGuard from '@/components/AuthGuard';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import EnvVarsDialog from '@/components/EnvVarsDialog';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ArrowLeft, FolderOpen, NotebookTabs } from 'lucide-react';
import { workspaceApi, type NotebookScope } from '@/lib/api';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
  createdAt: number;
}

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useDocumentTitle('账户设置');

  // Password change
  const [pwdOpen, setPwdOpen] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');

  // Email change
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');

  // Avatar change
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState('');

  // PersonalDir change
  const [dirOpen, setDirOpen] = useState(false);
  const [newDir, setNewDir] = useState('');
  const [dirError, setDirError] = useState('');
  const [dirSuccess, setDirSuccess] = useState('');

  // Workspace editor
  const [wsEditorOpen, setWsEditorOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookScope, setNotebookScope] = useState<NotebookScope>('personal');
  const [notebookShareToken, setNotebookShareToken] = useState<string | undefined>(undefined);
  const [notebookPermission, setNotebookPermission] = useState<'read' | 'write'>('write');
  const [showUserEnvVars, setShowUserEnvVars] = useState(false);
  const getHeaders = () => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
    return { Authorization: `Bearer ${t}` } as Record<string, string>;
  };

  useEffect(() => {
    fetch('/api/auth/me', { headers: getHeaders() })
      .then(r => r.json())
      .then(d => { setUser(d.user); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const openWorkspace = searchParams.get('workspace') === '1';
    if (openWorkspace) setWsEditorOpen(true);
  }, [searchParams]);

  useEffect(() => {
    const openNotebook = searchParams.get('notebook') === '1';
    if (!openNotebook) return;
    const scopeParam = searchParams.get('notebookScope');
    if (scopeParam === 'global') {
      router.replace(`/notebook?${searchParams.toString()}`);
      return;
    }

    const shareToken = searchParams.get('notebookShare') || '';
    const fileParam = searchParams.get('notebookFile');

    if (!shareToken) {
      setNotebookScope(scopeParam === 'global' ? 'global' : 'personal');
      setNotebookShareToken(undefined);
      setNotebookPermission('write');
      setNotebookOpen(true);
      return;
    }

    let cancelled = false;
    workspaceApi.resolveNotebookShare(shareToken)
      .then((share) => {
        if (cancelled) return;
        setNotebookScope(share.scope);
        setNotebookShareToken(shareToken);
        setNotebookPermission(share.permission);
        if (!fileParam) {
          const params = new URLSearchParams(searchParams.toString());
          params.set('notebook', '1');
          params.set('notebookScope', share.scope);
          params.set('notebookFile', share.path);
          params.set('notebookShare', shareToken);
          params.set('notebookPermission', share.permission);
          router.replace(`/account?${params.toString()}`);
        }
        setNotebookOpen(true);
      })
      .catch(() => {
        if (cancelled) return;
        setNotebookScope('personal');
        setNotebookShareToken(undefined);
        setNotebookPermission('write');
      });
    return () => { cancelled = true; };
  }, [router, searchParams]);

  const handleChangePassword = async () => {
    setPwdError(''); setPwdSuccess('');
    if (newPwd !== confirmPwd) { setPwdError('两次密码不一致'); return; }
    if (newPwd.length < 6) { setPwdError('密码至少6个字符'); return; }
    const res = await fetch('/api/auth/password', {
      method: 'PUT', headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
    });
    const data = await res.json();
    if (!res.ok) { setPwdError(data.error); return; }
    setPwdSuccess('密码修改成功');
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
    setTimeout(() => setPwdOpen(false), 1000);
  };

  const handleChangeEmail = async () => {
    setEmailError(''); setEmailSuccess('');
    if (!newEmail) { setEmailError('邮箱不能为空'); return; }
    const res = await fetch('/api/auth/email', {
      method: 'PUT', headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ newEmail }),
    });
    const data = await res.json();
    if (!res.ok) { setEmailError(data.error); return; }
    setEmailSuccess('邮箱修改成功');
    setUser(prev => prev ? { ...prev, email: newEmail } : prev);
    localStorage.setItem('auth-user', JSON.stringify({ ...user, email: newEmail }));
    setTimeout(() => setEmailOpen(false), 1000);
  };

  const handleChangeAvatar = async () => {
    if (!selectedAvatar || !user) return;
    const res = await fetch('/api/auth/profile', {
      method: 'PUT', headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: selectedAvatar }),
    });
    if (res.ok) {
      setUser(prev => prev ? { ...prev, avatar: selectedAvatar } : prev);
      localStorage.setItem('auth-user', JSON.stringify({ ...user, avatar: selectedAvatar }));
      setAvatarOpen(false);
    }
  };

  const handleChangeDir = async () => {
    setDirError(''); setDirSuccess('');
    const res = await fetch('/api/auth/profile', {
      method: 'PUT', headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalDir: newDir }),
    });
    const data = await res.json();
    if (!res.ok) { setDirError(data.error); return; }
    setDirSuccess('个人目录修改成功');
    setUser(prev => prev ? { ...prev, personalDir: newDir } : prev);
    localStorage.setItem('auth-user', JSON.stringify({ ...user, personalDir: newDir }));
    setTimeout(() => setDirOpen(false), 1000);
  };

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">加载中...</p></div>;
  }

  const initials = user.username?.charAt(0)?.toUpperCase() || '?';

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard"><ArrowLeft className="w-4 h-4 mr-2" />返回 Dashboard</Link>
          </Button>
          <div className="h-6 w-px bg-border" />
          <h1 className="text-2xl font-bold">账户设置</h1>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 max-w-2xl space-y-6">
        {/* Profile Card */}
        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-center gap-4">
            <button onClick={() => { setSelectedAvatar(user.avatar || ''); setAvatarOpen(true); }} className="group relative">
              <Avatar className="h-16 w-16">
                {user.avatar ? <AvatarImage src={`/avatar/${user.avatar}`} alt={user.username} /> : null}
                <AvatarFallback className="text-lg bg-primary/20 text-primary">{initials}</AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-sm">edit</span>
              </div>
            </button>
            <div>
              <h2 className="text-xl font-bold">{user.username}</h2>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${user.role === 'admin' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'}`}>
                {user.role === 'admin' ? '管理员' : '普通用户'}
              </span>
            </div>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => setNotebookOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setNotebookOpen(true);
            }
          }}
          className="w-full rounded-xl border bg-card p-6 text-left transition-colors hover:bg-muted/40 cursor-pointer"
        >
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-primary/10 p-3 text-primary">
              <NotebookTabs className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <span>Cangjie Notebook</span>
                    <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 border border-emerald-500/30">New</span>
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">在个人目录下使用 .cj.md 管理和运行 Notebook</p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0 pointer-events-none" tabIndex={-1}>
                  <FolderOpen className="mr-1 h-4 w-4" />打开
                </Button>
              </div>
              <p className="mt-3 font-mono text-xs text-muted-foreground">{user.personalDir || '未设置个人目录'}/.cangjie-notbook</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="rounded-xl border bg-card divide-y">
          <button onClick={() => { setPwdError(''); setPwdSuccess(''); setPwdOpen(true); }} className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-muted-foreground">lock</span>
              <span>修改密码</span>
            </div>
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <span>编辑</span>
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </span>
          </button>
          <button onClick={() => { setNewEmail(user.email); setEmailError(''); setEmailSuccess(''); setEmailOpen(true); }} className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-muted-foreground">mail</span>
              <span>修改邮箱</span>
            </div>
            <span className="inline-flex items-center gap-3 text-sm text-muted-foreground">
              <span>{user.email}</span>
              <span className="inline-flex items-center gap-1">
                <span>编辑</span>
                <span className="material-symbols-outlined text-sm">chevron_right</span>
              </span>
            </span>
          </button>
          <div className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
            <button onClick={() => { setNewDir(user.personalDir || ''); setDirError(''); setDirSuccess(''); setDirOpen(true); }} className="flex items-center gap-3">
              <span className="material-symbols-outlined text-muted-foreground">folder</span>
              <span>个人目录</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-mono">{user.personalDir || '未设置'}</span>
              {user.personalDir && (
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setWsEditorOpen(true)}>
                  <FolderOpen className="w-3.5 h-3.5 mr-1" />打开
                </Button>
              )}
              <button onClick={() => { setNewDir(user.personalDir || ''); setDirError(''); setDirSuccess(''); setDirOpen(true); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <span>编辑</span>
                <span className="material-symbols-outlined text-sm">chevron_right</span>
              </button>
            </div>
          </div>
          <button onClick={() => router.push('/account/system-settings')} className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-muted-foreground">settings</span>
              <span>系统设置</span>
            </div>
            <span className="material-symbols-outlined text-muted-foreground text-sm">chevron_right</span>
          </button>
          <button onClick={() => setShowUserEnvVars(true)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-muted-foreground">key</span>
              <span>个人环境变量</span>
            </div>
            <span className="material-symbols-outlined text-muted-foreground text-sm">chevron_right</span>
          </button>
        </div>
      </div>

      {/* Password Dialog */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>修改密码</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="password" placeholder="当前密码" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} />
            <Input type="password" placeholder="新密码（至少6位）" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
            <Input type="password" placeholder="确认新密码" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
            {pwdError && <p className="text-sm text-destructive">{pwdError}</p>}
            {pwdSuccess && <p className="text-sm text-green-500">{pwdSuccess}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdOpen(false)}>取消</Button>
            <Button onClick={handleChangePassword}>确认修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Dialog */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>修改邮箱</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="email" placeholder="新邮箱" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            {emailError && <p className="text-sm text-destructive">{emailError}</p>}
            {emailSuccess && <p className="text-sm text-green-500">{emailSuccess}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>取消</Button>
            <Button onClick={handleChangeEmail}>确认修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Avatar Dialog */}
      <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>选择头像</DialogTitle></DialogHeader>
          <AvatarPicker value={selectedAvatar} onChange={setSelectedAvatar} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvatarOpen(false)}>取消</Button>
            <Button onClick={handleChangeAvatar} disabled={!selectedAvatar}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PersonalDir Dialog */}
      <Dialog open={dirOpen} onOpenChange={setDirOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>修改个人目录</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="个人目录路径，如 /data/users/alice" value={newDir} onChange={e => setNewDir(e.target.value)} />
            <WorkspaceDirectoryPicker
              workspaceRoot="/"
              value={newDir}
              onChange={setNewDir}
            />
            <p className="text-xs text-muted-foreground">工作流执行时将在此目录下创建隔离的运行环境</p>
            {dirError && <p className="text-sm text-destructive">{dirError}</p>}
            {dirSuccess && <p className="text-sm text-green-500">{dirSuccess}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDirOpen(false)}>取消</Button>
            <Button onClick={handleChangeDir}>确认修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Workspace Editor */}
      {user.personalDir && (
        <>
          <WorkspaceEditor
            open={wsEditorOpen}
            onOpenChange={setWsEditorOpen}
            workspacePath={user.personalDir}
          />
          <WorkspaceEditor
            open={notebookOpen}
            onOpenChange={setNotebookOpen}
            workspacePath={user.personalDir}
            mode="notebook"
            title="Cangjie Notebook"
            notebookScope={notebookScope}
            notebookShareToken={notebookShareToken}
            notebookPermission={notebookPermission}
          />
        </>
      )}

      {showUserEnvVars && (
        <EnvVarsDialog scope="user" onClose={() => setShowUserEnvVars(false)} />
      )}
    </div>
  );
}

export default function AccountPage() {
  return <AuthGuard><AccountContent /></AuthGuard>;
}
