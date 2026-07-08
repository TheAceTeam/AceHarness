'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from '@/lib/navigation/client';
import { useCurrentUserQuery, useLoginMutation } from '@/client/query/auth';
import { motion } from 'framer-motion';
import { ClawCaptcha } from 'playcaptcha';
import 'playcaptcha/clawcaptcha.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { LockKeyhole, Mail, Settings } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const currentUser = useCurrentUserQuery();
  const loginMutation = useLoginMutation();
  useDocumentTitle('登录');
  const assetBase = `${(process.env.NEXT_PUBLIC_BASEURL || '/').replace(/\/?$/, '/')}toys/`;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [captchaMounted, setCaptchaMounted] = useState(false);

  useEffect(() => {
    if (currentUser.data) router.push('/');
  }, [currentUser.data, router]);

  useEffect(() => {
    setCaptchaMounted(true);
  }, []);

  const handleLogin = useCallback(async () => {
    setError('');
    if (captchaRequired && !captchaVerified) {
      setError('请先完成人机验证。');
      return;
    }
    setLoading(true);

    try {
      await loginMutation.mutateAsync({ email, password });
      router.push('/');
    } catch (err: any) {
      setError(err.message || '登录失败');
      setCaptchaRequired(true);
      setCaptchaVerified(false);
    } finally {
      setLoading(false);
    }
  }, [captchaRequired, captchaVerified, email, loginMutation, password, router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLogin();
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#E9E6F5] px-4 py-8 text-[#151515] dark:bg-[#0D0E14] dark:text-slate-100 sm:px-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.92),rgba(255,255,255,0.44)_34%,rgba(233,230,245,0)_68%)] dark:bg-[radial-gradient(circle_at_50%_30%,rgba(59,130,246,0.14),rgba(139,92,246,0.12)_38%,transparent_70%)]" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-32 bg-gradient-to-b from-white/60 to-transparent dark:from-violet-500/8" />
      <div className="relative mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-4xl items-center justify-center">
        <motion.main
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[360px]"
        >
          <div className="mb-10 flex flex-col items-center text-center">
            <div className="flex items-center gap-4">
              <RobotLogo size={52} />
              <h1 className="text-[26px] font-black tracking-tight">ACEHarness</h1>
            </div>
            <p className="mt-3 text-sm text-[#8A8A84]">登录后进入你的 Agent 工作台</p>
          </div>

          <section>
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="sr-only" htmlFor="login-email">邮箱</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8A84]" />
                <Input
                  id="login-email"
                  type="email"
                  placeholder="邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 rounded-full border-0 bg-[#DEE0E5]/95 pl-12 pr-5 text-sm shadow-inner shadow-white/20 placeholder:text-[#73736D] focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/35 dark:bg-[#191A20] dark:text-slate-100 dark:placeholder:text-slate-500 dark:shadow-none"
                />
              </div>

              <label className="sr-only" htmlFor="login-password">密码</label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8A84]" />
                <Input
                  id="login-password"
                  type="password"
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 rounded-full border-0 bg-[#DEE0E5]/95 pl-12 pr-5 text-sm shadow-inner shadow-white/20 placeholder:text-[#73736D] focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/35 dark:bg-[#191A20] dark:text-slate-100 dark:placeholder:text-slate-500 dark:shadow-none"
                />
              </div>

              <div className="flex items-center justify-between px-1 text-xs">
                <Button type="button" variant="link" className="h-auto p-0 text-xs font-medium text-[#158277]" onClick={() => router.push('/login/reset')}>
                  忘记密码
                </Button>
                <Button type="button" variant="link" className="h-auto p-0 text-xs font-medium text-[#158277]" onClick={() => router.push('/register')}>
                  申请注册
                </Button>
              </div>

              {captchaRequired && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="overflow-hidden rounded-2xl border border-white/70 bg-white/70 p-2 shadow-sm backdrop-blur-sm [--clawcap-accent:#8B5CF6] [--clawcap-bg:#FFFFFF] [--clawcap-ink:#151515] [--clawcap-muted:#8A8A84] dark:border-white/10 dark:bg-[#191A20]/90 dark:shadow-none"
                >
                  {captchaMounted ? (
                    <ClawCaptcha
                      title="完成验证后继续登录"
                      target="panda"
                      assetBase={assetBase}
                      onVerify={() => {
                        setCaptchaVerified(true);
                        setError('');
                      }}
                    />
                  ) : (
                    <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-[#E3E3DF] bg-white/70 text-sm text-[#8A8A84] dark:border-white/10 dark:bg-[#191A20] dark:text-slate-400">
                      正在准备人机验证
                    </div>
                  )}
                </motion.div>
              )}

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3 text-sm text-red-700"
                >
                  {error}
                </motion.div>
              )}

              <Button
                type="submit"
                variant="outline"
                className="mt-2 h-12 w-full rounded-full border-0 bg-white/85 text-sm font-semibold text-[#73736D] shadow-sm hover:bg-white dark:bg-[#191A20]/90 dark:text-slate-100 dark:shadow-none dark:hover:bg-white/10"
                disabled={loading || (captchaRequired && !captchaVerified)}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <RobotLogo size={18} />
                    登录中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">login</span>
                    登录
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-7 flex justify-center">
              <Button type="button" variant="ghost" className="h-auto gap-2 rounded-full px-4 py-2 text-xs text-[#73736D] hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10" onClick={() => router.push('/setup')}>
                <Settings className="h-4 w-4 shrink-0" />
                首次设置
              </Button>
            </div>
          </section>
          <p className="mt-24 text-center text-xs text-[#AAA7B8]">© 2026 ACEHarness. All rights reserved.</p>
        </motion.main>
      </div>
    </div>
  );
}
