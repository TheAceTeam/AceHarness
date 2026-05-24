'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RobotLogo } from '@/components/chat/ChatMessage';
import { KeyRound, Settings, UserPlus } from 'lucide-react';

const CAROUSEL_ITEMS = [
  {
    title: '系统架构',
    description: '三层架构：前端交互层、编排调度层、执行引擎层',
    imageUrl: '/images/system-architecture.svg',
  },
  {
    title: '状态机引擎',
    description: '可视化状态机设计器，支持复杂工作流编排',
    imageUrl: '/images/state-machine-engine.svg',
  },
  {
    title: '工作流案例',
    description: '智能体协作、多阶段测试、自动化执行',
    imageUrl: '/images/workflow-cases-overview.svg',
  },
];

export default function LoginPage() {
  const router = useRouter();
  useDocumentTitle('登录');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);

  // Check if already logged in
  useEffect(() => {
    const token = localStorage.getItem('auth-token');
    if (token) {
      router.push('/');
    }
  }, [router]);

  // Auto-rotate carousel
  useEffect(() => {
    const interval = setInterval(() => {
      setCarouselIndex((i) => (i + 1) % CAROUSEL_ITEMS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLogin = useCallback(async () => {
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '登录失败');
        return;
      }

      // Store token and user info
      localStorage.setItem('auth-token', data.token);
      localStorage.setItem('auth-user', JSON.stringify(data.user || { email }));

      router.push('/');
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }, [email, password, router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLogin();
  };

  const currentCarouselItem = CAROUSEL_ITEMS[carouselIndex];

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left side - Carousel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary/20 via-background to-blue-500/10 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent z-10" />

        {/* Carousel content */}
        <div className="relative z-20 flex flex-col justify-end p-12 w-full">
          <motion.div
            key={carouselIndex}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 flex items-center justify-center p-8"
          >
            <img
              src={currentCarouselItem.imageUrl}
              alt={currentCarouselItem.title}
              className="w-full h-full object-contain"
            />
          </motion.div>

          {/* Carousel indicators */}
          <div className="flex justify-center gap-2 mb-4 z-20">
            {CAROUSEL_ITEMS.map((_, i) => (
              <button
                key={i}
                onClick={() => setCarouselIndex(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === carouselIndex
                    ? 'w-8 bg-primary'
                    : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                }`}
              />
            ))}
          </div>

          {/* Carousel text */}
          <motion.div
            key={`text-${carouselIndex}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="text-center z-20"
          >
            <h3 className="text-xl font-bold text-foreground mb-1">
              {currentCarouselItem.title}
            </h3>
            <p className="text-sm text-muted-foreground">
              {currentCarouselItem.description}
            </p>
          </motion.div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-20 left-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      {/* Right side - Login form */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            {/* Hero Title */}
            <div className="mb-10 text-center">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                <span className="relative inline-block">
                  <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent animate-gradientShift bg-[length:200%_100%]">
                    ACEHarness
                  </span>
                  <span className="absolute inset-0 blur-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent opacity-30 animate-pulse" aria-hidden="true">
                    ACEHarness
                  </span>
                </span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground animate-fadeInUp">
                Your team of AIs, collaborating to get work done.
              </p>
              <div className="mt-6 flex justify-center gap-2">
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm">
                  <span className="material-symbols-outlined text-sm">auto_awesome</span>
                  Multi-Agent
                </span>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-purple-500/10 text-purple-500 text-sm">
                  <span className="material-symbols-outlined text-sm">psychology</span>
                  Intelligent
                </span>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-pink-500/10 text-pink-500 text-sm">
                  <span className="material-symbols-outlined text-sm">speed</span>
                  Efficient
                </span>
              </div>
            </div>

            {/* Logo */}
            <div className="flex items-center gap-3 mb-8">
              <RobotLogo size={48} className="animate-deerRotate" />
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
                  ACEHarness
                </h1>
                <p className="text-xs text-muted-foreground">全流程 AI Multi-Agent 智能协作系统</p>
              </div>
            </div>

          {/* Form */}
          <div className="bg-card rounded-2xl border p-8 shadow-xl">
            <div className="mb-6">
              <h2 className="text-xl font-semibold">登录</h2>
              <p className="text-sm text-muted-foreground mt-1">请输入账户信息</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">邮箱</label>
                <Input
                  type="email"
                  placeholder="请输入邮箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-10"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">密码</label>
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-10"
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm"
                >
                  {error}
                </motion.div>
              )}

              <Button
                type="submit"
                className="w-full h-10"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <RobotLogo size={18} className="animate-deerRotate" />
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
          </div>

          {/* Footer */}
          <div className="mt-6 rounded-xl border bg-card/60 p-2 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <Button variant="ghost" className="h-auto justify-start gap-2 px-3 py-2 text-left text-xs text-muted-foreground" onClick={() => router.push('/login/reset')}>
                <KeyRound className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">忘记密码</span>
                  <span className="block truncate">密保重置</span>
                </span>
              </Button>
              <Button variant="ghost" className="h-auto justify-start gap-2 px-3 py-2 text-left text-xs text-muted-foreground" onClick={() => router.push('/register')}>
                <UserPlus className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">申请注册</span>
                  <span className="block truncate">新用户入口</span>
                </span>
              </Button>
              <Button variant="ghost" className="h-auto justify-start gap-2 px-3 py-2 text-left text-xs text-muted-foreground" onClick={() => router.push('/setup')}>
                <Settings className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">首次设置</span>
                  <span className="block truncate">初始化系统</span>
                </span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
