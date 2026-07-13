'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, KeyRound, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/brand/RobotLogo';

export default function ResetPasswordPage() {
  const router = useRouter();
  useDocumentTitle('找回密码');
  const [step, setStep] = useState<'email' | 'answer' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const normalizedEmail = useMemo(() => email.trim(), [email]);
  const steps = [
    { index: '1', label: '确认邮箱', done: step !== 'email' },
    { index: '2', label: '回答密保', done: step === 'done' },
    { index: '3', label: '完成重置', done: step === 'done' },
  ];

  const handleGetQuestion = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError('');
    if (!normalizedEmail) {
      setError('请输入注册邮箱');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, step: 'question' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '未找到密保问题');
        return;
      }
      setQuestion(data.question || '');
      setStep('answer');
    } catch {
      setError('请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError('');
    if (!answer.trim()) {
      setError('请输入密保答案');
      return;
    }
    if (newPassword.length < 6) {
      setError('新密码至少 6 个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, answer, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '重置密码失败');
        return;
      }
      setStep('done');
    } catch {
      setError('请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const resetToEmailStep = () => {
    setStep('email');
    setQuestion('');
    setAnswer('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.04),transparent_42%)] p-6">
      <div className="mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-2xl border bg-card shadow-2xl md:grid-cols-[0.9fr_1.1fr]">
          <div className="hidden border-r bg-muted/40 p-8 md:flex md:flex-col md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <RobotLogo size={44} className="animate-robotPulse" />
                <div>
                  <h1 className="text-2xl font-bold">CSIHarness</h1>
                  <p className="text-xs text-muted-foreground">Account Recovery</p>
                </div>
              </div>
              <div className="mt-12 space-y-5">
                <div className="rounded-xl border bg-background/70 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <ShieldQuestion className="h-4 w-4" />
                    密保校验
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    通过注册时设置的安全问题确认身份，然后设置新密码。
                  </p>
                </div>
                <div className="rounded-xl border bg-background/70 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <KeyRound className="h-4 w-4" />
                    本地账号体系
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    重置成功后旧密码立即失效，可直接返回登录页使用新密码登录。
                  </p>
                </div>
              </div>
            </div>
            <Button variant="ghost" className="w-fit gap-2 px-0 text-muted-foreground hover:bg-transparent" onClick={() => router.push('/login')}>
              <ArrowLeft className="h-4 w-4" />
              返回登录
            </Button>
          </div>

          <div className="p-6 sm:p-8">
            <Button variant="ghost" className="mb-6 gap-2 px-0 md:hidden" onClick={() => router.push('/login')}>
              <ArrowLeft className="h-4 w-4" />
              返回登录
            </Button>

            <div className="mb-8">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                密保问题重置密码
              </div>
              <h2 className="text-2xl font-semibold">找回账号访问权限</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                输入注册邮箱获取密保问题，回答正确后即可设置新密码。
              </p>
            </div>

            <div className="mb-8 grid grid-cols-3 gap-2 text-xs">
              {steps.map(({ index, label, done }) => (
                <div key={index} className={`rounded-lg border px-3 py-2 ${done ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-background text-muted-foreground'}`}>
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]">{index}</span>
                  {label}
                </div>
              ))}
            </div>

            {step === 'email' && (
              <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={handleGetQuestion} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">注册邮箱</label>
                  <Input
                    placeholder="name@example.com"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    className="h-11"
                  />
                </div>
                {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
                <Button type="submit" className="h-11 w-full" disabled={loading}>
                  {loading ? '查询中...' : '获取密保问题'}
                </Button>
              </motion.form>
            )}

            {step === 'answer' && (
              <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={handleReset} className="space-y-4">
                <div className="rounded-xl border bg-muted/40 p-4">
                  <div className="text-xs text-muted-foreground">密保问题</div>
                  <div className="mt-1 text-sm font-medium">{question || '该账号未设置密保问题'}</div>
                  <Button type="button" variant="link" className="mt-2 h-auto p-0 text-xs" onClick={resetToEmailStep}>
                    换一个邮箱
                  </Button>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">密保答案</label>
                  <Input value={answer} onChange={(event) => setAnswer(event.target.value)} required className="h-11" placeholder="请输入密保答案" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">新密码</label>
                    <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={6} className="h-11" placeholder="至少 6 个字符" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">确认新密码</label>
                    <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={6} className="h-11" placeholder="再次输入新密码" />
                  </div>
                </div>
                {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
                <Button type="submit" className="h-11 w-full" disabled={loading}>
                  {loading ? '重置中...' : '重置密码'}
                </Button>
              </motion.form>
            )}

            {step === 'done' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border bg-primary/5 p-6 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
                <h3 className="mt-4 text-lg font-semibold">密码已重置</h3>
                <p className="mt-2 text-sm text-muted-foreground">现在可以使用新密码登录 CSIHarness。</p>
                <Button className="mt-6 h-11 w-full" onClick={() => router.push('/login')}>
                  返回登录
                </Button>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
