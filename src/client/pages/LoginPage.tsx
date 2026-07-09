'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from '@/lib/navigation/client';
import { useCurrentUserQuery, useLoginMutation } from '@/client/query/auth';
import { normalizeAuthReturnTo } from '@/lib/navigation/return-target';
import { motion } from 'framer-motion';
import { ClawCaptcha } from 'playcaptcha';
import 'playcaptcha/clawcaptcha.css';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { ArrowRight, LockKeyhole, Mail, Settings } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentUser = useCurrentUserQuery();
  const loginMutation = useLoginMutation();
  const { toast } = useToast();
  useDocumentTitle('登录');
  const assetBase = `${(process.env.NEXT_PUBLIC_BASEURL || '/').replace(/\/?$/, '/')}toys/`;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [captchaMounted, setCaptchaMounted] = useState(false);
  const [captchaDialogOpen, setCaptchaDialogOpen] = useState(false);
  const lastLoginErrorToastRef = useRef('');
  const returnTo = normalizeAuthReturnTo(searchParams.get('returnTo')) || '/';

  useEffect(() => {
    if (currentUser.data) router.replace(returnTo);
  }, [currentUser.data, returnTo, router]);

  useEffect(() => {
    setCaptchaMounted(true);
  }, []);

  const handleLogin = useCallback(async () => {
    if (captchaRequired && !captchaVerified) {
      setCaptchaDialogOpen(true);
      toast('warning', '请先完成人机验证。');
      return;
    }
    setLoading(true);
    setLoginError(null);

    try {
      await loginMutation.mutateAsync({ email, password });
      router.replace(returnTo);
    } catch (err: any) {
      const message = err.message || '登录失败';
      setLoginError(message);
      if (lastLoginErrorToastRef.current !== message) {
        toast('error', message);
        lastLoginErrorToastRef.current = message;
      }
      setCaptchaRequired(true);
      setCaptchaVerified(false);
      setCaptchaDialogOpen(true);
    } finally {
      setLoading(false);
    }
  }, [captchaRequired, captchaVerified, email, loginMutation, password, returnTo, router, toast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLogin();
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#F4F4F1] px-4 py-6 text-[#151515] dark:bg-[#0D0E14] dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.82),rgba(244,244,241,0.92)_45%,rgba(237,237,233,0.78))] dark:bg-[linear-gradient(120deg,rgba(18,19,25,0.98),rgba(13,14,20,0.96)_48%,rgba(23,25,33,0.92))]" />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#158277]/45 to-transparent dark:via-cyan-300/40"
        animate={{ opacity: [0.25, 0.8, 0.25], x: ['-12%', '12%', '-12%'] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-6xl items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="grid w-full overflow-hidden rounded-2xl border border-[#E3E3DF] bg-white shadow-[0_28px_80px_rgba(21,21,21,0.10)] dark:border-white/10 dark:bg-[#161820] dark:shadow-black/35 lg:min-h-[620px] lg:grid-cols-[1.04fr_0.96fr] lg:items-stretch"
        >
          <aside className="relative hidden min-h-full flex-col justify-between overflow-hidden bg-[#151515] p-8 text-white lg:flex xl:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.08),transparent_34%),linear-gradient(315deg,rgba(21,130,119,0.18),transparent_42%)]" />
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 top-24 h-px bg-gradient-to-r from-transparent via-[#45D6C8]/70 to-transparent"
              animate={{ x: ['-60%', '60%'], opacity: [0.2, 0.75, 0.2] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
            />

            <div className="relative">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#151515]">
                  <RobotLogo size={30} />
                </div>
                <div>
                  <div className="text-lg font-black tracking-tight">ACEHarness</div>
                  <div className="text-xs text-white/52">Agent Centric Engineering Harness</div>
                </div>
              </div>

              <div className="mt-16 max-w-md">
                <div className="inline-flex rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs font-semibold text-[#9FE8DF]">
                  Your team of AI
                </div>
                <h1 className="mt-5 text-5xl font-black leading-[1.02] tracking-tight">
                  让复杂研发任务进入可控协作流
                </h1>
                <p className="mt-5 text-base leading-7 text-white/66">
                  多 Agent 议场、状态机工作流、Supervisor 路由和长期记忆协同工作，帮助工程任务被规划、执行、审查、恢复和复盘。
                </p>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
                <motion.div
                  className="mb-4 h-1 rounded-full bg-gradient-to-r from-[#45D6C8] via-white/80 to-[#45D6C8]"
                  animate={{ opacity: [0.42, 0.9, 0.42] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                />
                <div className="grid grid-cols-4 gap-2">
                  {['规划', '执行', '审查', '复盘'].map((item, index) => (
                    <motion.div
                      key={item}
                      className="rounded-xl border border-white/10 bg-black/18 px-3 py-3"
                      animate={{ y: [0, -2, 0], opacity: [0.72, 1, 0.72] }}
                      transition={{ duration: 2.6, repeat: Infinity, delay: index * 0.18, ease: 'easeInOut' }}
                    >
                      <div className="mb-3 h-1.5 w-1.5 rounded-full bg-[#45D6C8] shadow-[0_0_14px_rgba(69,214,200,0.62)]" />
                      <div className="text-xs font-semibold text-white/86">{item}</div>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { value: 'Spec', label: '需求驱动' },
                  { value: 'FSM', label: '状态机' },
                  { value: 'RAG', label: '记忆沉淀' },
                ].map((item) => (
                  <div key={item.value} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-lg font-black text-white">{item.value}</div>
                    <div className="mt-1 text-xs text-white/48">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="flex min-h-[620px] flex-col bg-white p-5 dark:bg-[#161820] sm:p-8 lg:min-h-full lg:p-10">
            <div className="mb-8 flex items-start justify-between gap-4 lg:hidden">
              <div className="flex items-center gap-3">
                <RobotLogo size={38} />
                <div>
                  <div className="text-xl font-black tracking-tight">ACEHarness</div>
                  <div className="text-xs text-muted-foreground">Your team of AI</div>
                </div>
              </div>
            </div>

            <div className="flex flex-1 items-center">
              <div className="w-full">
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-black tracking-tight text-[#151515] dark:text-white">登录工作台</h2>
                    <p className="mt-2 text-sm leading-6 text-[#6A6A64] dark:text-slate-400">继续进入你的 Agent 工程协作空间。</p>
                  </div>
                  <motion.div
                    className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#151515] text-white lg:flex"
                    animate={{ boxShadow: ['0 0 0 rgba(21,130,119,0)', '0 0 22px rgba(21,130,119,0.24)', '0 0 0 rgba(21,130,119,0)'] }}
                    transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <LockKeyhole className="h-5 w-5" />
                  </motion.div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-[#151515] dark:text-slate-200" htmlFor="login-email">邮箱</label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8A84] dark:text-slate-500" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="邮箱"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setLoginError(null);
                          lastLoginErrorToastRef.current = '';
                        }}
                        required
                        className="h-12 rounded-lg border-[#E3E3DF] bg-white pl-11 pr-4 text-sm text-[#151515] placeholder:text-[#8A8A84] focus-visible:ring-2 focus-visible:ring-[#158277]/25 dark:border-white/10 dark:bg-[#11131A] dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-[#151515] dark:text-slate-200" htmlFor="login-password">密码</label>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8A84] dark:text-slate-500" />
                      <Input
                        id="login-password"
                        type="password"
                        placeholder="密码"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setLoginError(null);
                          lastLoginErrorToastRef.current = '';
                        }}
                        required
                        className="h-12 rounded-lg border-[#E3E3DF] bg-white pl-11 pr-4 text-sm text-[#151515] placeholder:text-[#8A8A84] focus-visible:ring-2 focus-visible:ring-[#158277]/25 dark:border-white/10 dark:bg-[#11131A] dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 text-xs">
                    <Button type="button" variant="link" className="h-auto cursor-pointer p-0 text-xs font-semibold text-[#158277] hover:text-[#0D5F57] dark:text-cyan-300 dark:hover:text-cyan-200" onClick={() => router.push('/login/reset')}>
                      忘记密码
                    </Button>
                    <Button type="button" variant="link" className="h-auto cursor-pointer p-0 text-xs font-semibold text-[#158277] hover:text-[#0D5F57] dark:text-cyan-300 dark:hover:text-cyan-200" onClick={() => router.push('/register')}>
                      申请注册
                    </Button>
                  </div>

                  {loginError ? (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50/95 px-4 py-3 text-sm leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                      {loginError}
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    variant="outline"
                    className="mt-1 h-12 w-full cursor-pointer rounded-lg border border-[#151515] bg-[#151515] text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#2B2B2B] focus-visible:ring-2 focus-visible:ring-[#158277]/25 disabled:cursor-not-allowed disabled:border-[#D8D8D2] disabled:bg-[#D8D8D2] disabled:text-[#8A8A84] dark:border-white/10 dark:bg-white dark:text-[#151515] dark:hover:bg-slate-200 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                    disabled={loading || (captchaRequired && !captchaVerified)}
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <RobotLogo size={18} />
                        登录中...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <ArrowRight className="h-4 w-4" />
                        登录
                      </span>
                    )}
                  </Button>
                </form>
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-[#E3E3DF] pt-5 dark:border-white/10">
              <p className="text-xs text-[#AAA7A0] dark:text-slate-500">© 2026 ACEHarness</p>
              <Button type="button" variant="ghost" className="h-auto cursor-pointer gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#73736D] hover:bg-[#F7F7F4] hover:text-[#151515] dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white" onClick={() => router.push('/setup')}>
                <Settings className="h-4 w-4 shrink-0" />
                首次设置
              </Button>
            </div>
          </main>
        </motion.div>
      </div>

      <Dialog open={captchaDialogOpen} onOpenChange={setCaptchaDialogOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-2rem))] max-w-none overflow-hidden p-0">
          <DialogHeader className="border-b border-[#E3E3DF] bg-white px-5 py-4 text-left dark:border-white/10 dark:bg-[#161820]">
            <DialogTitle>完成人机验证</DialogTitle>
            <DialogDescription>
              验证通过后可继续提交登录。
            </DialogDescription>
          </DialogHeader>
          <div className="bg-[#F7F7F4] p-3 [--clawcap-accent:#158277] [--clawcap-bg:#FFFFFF] [--clawcap-ink:#151515] [--clawcap-muted:#8A8A84] dark:bg-[#11131A]">
            {captchaMounted ? (
              <ClawCaptcha
                title="拖动完成验证"
                target="panda"
                assetBase={assetBase}
                onVerify={() => {
                  setCaptchaVerified(true);
                  setCaptchaDialogOpen(false);
                  toast('success', '验证已完成，请继续登录。');
                }}
              />
            ) : (
              <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-[#E3E3DF] bg-white text-sm text-[#8A8A84] dark:border-white/10 dark:bg-[#11131A] dark:text-slate-400">
                正在准备人机验证
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
