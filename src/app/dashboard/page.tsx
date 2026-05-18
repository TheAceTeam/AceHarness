'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { Activity, Zap, Cpu, TrendingUp, Clock, CheckCircle2, XCircle, AlertCircle, Workflow, Bot, Settings, Play, Package, Cog, FileText, History, Key, NotebookTabs, Layers3, Trophy, Loader2, BarChart3 } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import NewConfigModal from '@/components/NewConfigModal';
import UserMenu from '@/components/UserMenu';
import { RobotLogo } from '@/components/chat/ChatMessage';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import pkgJson from '../../../package.json';

interface DashboardStats {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  activeWorkflows: number;
  weeklyRuns: number;
  totalTokenUsage: number;
  weeklyTokenUsage: number;
  totalAgents: number;
  runningProcesses: number;
}

interface TokenRankingItem {
  name: string;
  configFile?: string;
  runs: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cost: number;
}

interface RunTokenUsageItem {
  id: string;
  configFile: string;
  configName: string;
  status: string;
  startTime: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cost: number;
}

const WORKFLOW_TOKEN_RANKING_HREF = '/run-history?view=token-ranking&dimension=workflow&sortKey=totalTokens&sortDirection=desc&page=1';
const DASHBOARD_CACHE_KEY = 'dashboard-cache';
const DASHBOARD_CACHE_TTL = 5 * 60 * 1000;
const CHART_SERIES_COLORS = ['#38bdf8', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'];
const TOKEN_STACK_COLORS = {
  inputTokens: '#38bdf8',
  outputTokens: '#8b5cf6',
  cacheTokens: '#f59e0b',
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value || 0);
}

function formatMoney(value: number): string {
  return `$${(value || 0).toFixed(4)}`;
}

function formatStateName(name: string): string {
  if (name === '__origin__') return '开始';
  if (name === '__human_approval__') return '人工审查';
  return name;
}

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useTranslations();
  useDocumentTitle('控制台');
  const [stats, setStats] = useState<DashboardStats>({
    totalRuns: 0,
    successRate: 0,
    avgDuration: 0,
    activeWorkflows: 0,
    weeklyRuns: 0,
    totalTokenUsage: 0,
    weeklyTokenUsage: 0,
    totalAgents: 0,
    runningProcesses: 0,
  });
  const [configs, setConfigs] = useState<any[]>([]);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [agentUsageData, setAgentUsageData] = useState<any[]>([]);
  const [activityData, setActivityData] = useState<any[]>([]);
  const [runningRuns, setRunningRuns] = useState<any[]>([]);
  const [tokenRankingByUser, setTokenRankingByUser] = useState<TokenRankingItem[]>([]);
  const [tokenRankingByWorkflow, setTokenRankingByWorkflow] = useState<TokenRankingItem[]>([]);
  const [runTokenUsageRanking, setRunTokenUsageRanking] = useState<RunTokenUsageItem[]>([]);
  const [tokenActivityData, setTokenActivityData] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<{ username: string; email: string; role: 'admin' | 'user'; avatar?: string } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('auth-user');
      if (stored) setCurrentUser(JSON.parse(stored));
    } catch {}
  }, []);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      const weekDays = [0, 1, 2, 3, 4, 5, 6].map((i) => t(`dashboard.weekdays.${i}`));
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
      const res = await fetch('/api/dashboard', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401) {
        localStorage.removeItem('auth-token');
        localStorage.removeItem('auth-user');
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error('Dashboard API failed');
      const data = await res.json();

      if (!data || !data.stats) {
        console.warn('Dashboard API returned incomplete data');
        return;
      }

      setStats(data.stats);
      setConfigs(data.configs || []);
      setRecentRuns(data.recentRuns || []);
      setRunningRuns(data.runningRuns || []);
      setAgentUsageData(data.agentUsageData || []);
      setTokenRankingByUser(data.tokenRankingByUser || []);
      setTokenRankingByWorkflow(data.tokenRankingByWorkflow || []);
      setRunTokenUsageRanking(data.runTokenUsageRanking || []);
      setTokenActivityData((data.tokenActivityData || []).map((d: any) => ({
        name: weekDays[d.dayOfWeek],
        totalTokens: d.totalTokens || 0,
      })));

      const actData = (data.activityData || []).map((d: any) => ({
        name: weekDays[d.dayOfWeek],
        runs: d.runs,
      }));
      setActivityData(actData);

      try {
        sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          stats: data.stats,
          configs: data.configs || [],
          recentRuns: data.recentRuns || [],
          runningRuns: data.runningRuns || [],
          agentUsageData: data.agentUsageData || [],
          tokenRankingByUser: data.tokenRankingByUser || [],
          tokenRankingByWorkflow: data.tokenRankingByWorkflow || [],
          runTokenUsageRanking: data.runTokenUsageRanking || [],
          tokenActivityData: (data.tokenActivityData || []).map((d: any) => ({
            name: weekDays[d.dayOfWeek],
            totalTokens: d.totalTokens || 0,
          })),
          activityData: actData,
        }));
      } catch {}
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    // Try to load from cache first for instant render
    try {
      const raw = sessionStorage.getItem(DASHBOARD_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts < DASHBOARD_CACHE_TTL) {
          setStats(cached.stats);
          setConfigs(cached.configs);
          setRecentRuns(cached.recentRuns);
          setRunningRuns(cached.runningRuns);
          setAgentUsageData(cached.agentUsageData || []);
          setActivityData(cached.activityData || []);
          setTokenRankingByUser(cached.tokenRankingByUser || []);
          setTokenRankingByWorkflow(cached.tokenRankingByWorkflow || []);
          setRunTokenUsageRanking(cached.runTokenUsageRanking || []);
          setTokenActivityData(cached.tokenActivityData || []);
          setLoading(false);
        }
      }
    } catch {}
    void loadDashboardData();
  }, [loadDashboardData]);

  const StatCard = ({ icon: Icon, label, value, trend, color }: any) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02, boxShadow: '0 0 30px rgba(59, 130, 246, 0.3)' }}
      className="relative bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-xl border border-border/50 rounded-xl p-6 overflow-hidden group"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-3 rounded-lg bg-gradient-to-br ${color}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
          {trend && (
            <Badge variant="secondary" className="text-xs">
              <TrendingUp className="w-3 h-3 mr-1" />
              {trend}
            </Badge>
          )}
        </div>
        <div className="text-3xl font-bold mb-1">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
      <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl" />
    </motion.div>
  );

  const QuickAction = ({ icon: Icon, label, onClick, color, desc }: any) => (
    <motion.button
      whileHover={{ y: -3, boxShadow: '0 12px 30px -8px rgba(0,0,0,0.12)' }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="relative bg-card hover:bg-card/80 px-4 py-4 rounded-xl border border-border/60 hover:border-primary/30 overflow-hidden group transition-all text-left"
    >
      <div className="flex items-center gap-3.5">
        <div className={`shrink-0 w-11 h-11 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center shadow-sm`}>
          <Icon className="w-5.5 h-5.5 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors truncate">{label}</div>
          {desc && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{desc}</div>}
        </div>
      </div>
    </motion.button>
  );

  const TokenRankingList = ({
    title,
    items,
    actionHref,
    actionLabel,
  }: {
    title: string;
    items: TokenRankingItem[];
    actionHref?: string;
    actionLabel?: string;
  }) => (
    <ChartShell
      title={title}
      icon={Cpu}
      description={t('dashboard.tokenRanking.workflowSubtitle')}
      action={actionHref && actionLabel ? (
        <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs" asChild>
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : null}
      className="h-full"
    >
      {loading ? (
        <ChartState loading height={180} />
      ) : items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item, index) => {
            const cacheTokens = (item.cacheCreationInputTokens || 0) + (item.cacheReadInputTokens || 0);
            const maxTokens = Math.max(...items.map((entry) => entry.totalTokens || 0), 1);
            return (
              <div key={`${item.configFile || item.name}-${index}`} className="rounded-xl border border-border/40 bg-background/55 p-3.5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.name || item.configFile || '-'}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t('dashboard.tokenRanking.runs')}: {item.runs} · {t('dashboard.tokenRanking.cost')}: {formatMoney(item.cost)}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold">{formatTokens(item.totalTokens)}</div>
                    <div className="text-xs text-muted-foreground">{t('dashboard.tokenRanking.totalTokens')}</div>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/70">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#38bdf8,#8b5cf6,#f59e0b)]"
                    style={{ width: `${Math.max(12, Math.round((item.totalTokens / maxTokens) * 100))}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {t('dashboard.tokenRanking.breakdown')
                    .replace('{input}', formatTokens(item.inputTokens))
                    .replace('{output}', formatTokens(item.outputTokens))
                    .replace('{cache}', formatTokens(cacheTokens))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ChartState loading={false} empty height={180} />
      )}
    </ChartShell>
  );

  const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#6366f1'];

  const workflowComparisonData = tokenRankingByWorkflow.slice(0, 6).map((item) => ({
    name: item.name || item.configFile || '-',
    inputTokens: item.inputTokens || 0,
    outputTokens: item.outputTokens || 0,
    cacheTokens: (item.cacheCreationInputTokens || 0) + (item.cacheReadInputTokens || 0),
    totalTokens: item.totalTokens || 0,
  }));

  const runRankingChartData = runTokenUsageRanking.slice(0, 8).map((item) => ({
    name: item.configName || item.configFile || '-',
    totalTokens: item.totalTokens || 0,
    status: item.status,
    cost: item.cost,
  }));

  const recentTokenTrendData = recentRuns
    .slice()
    .reverse()
    .map((run: any, index: number) => ({
      name: `#${index + 1}`,
      workflow: run.configName || run.configFile || '-',
      totalTokens: Number(run.totalTokens || 0),
      status: run.status,
      startTime: run.startTime,
    }));

  const tokenCompositionData = [
    {
      name: t('dashboard.charts.inputTokens'),
      value: workflowComparisonData.reduce((sum, row) => sum + Number(row.inputTokens || 0), 0),
      color: TOKEN_STACK_COLORS.inputTokens,
    },
    {
      name: t('dashboard.charts.outputTokens'),
      value: workflowComparisonData.reduce((sum, row) => sum + Number(row.outputTokens || 0), 0),
      color: TOKEN_STACK_COLORS.outputTokens,
    },
    {
      name: t('dashboard.charts.cacheTokens'),
      value: workflowComparisonData.reduce((sum, row) => sum + Number(row.cacheTokens || 0), 0),
      color: TOKEN_STACK_COLORS.cacheTokens,
    },
  ].filter((item) => item.value > 0);

  const activityChartData = activityData.map((item, index) => ({
    ...item,
    fill: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
  }));

  const agentCallsChartData = agentUsageData.map((item, index) => ({
    ...item,
    fill: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
  }));

  const ChartShell = ({
    title,
    icon: Icon,
    description,
    children,
    action,
    className,
  }: {
    title: string;
    icon: any;
    description?: string;
    children: ReactNode;
    action?: ReactNode;
    className?: string;
  }) => (
    <div className={`relative overflow-hidden rounded-2xl border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl ${className || ''}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(139,92,246,0.12),transparent_30%)]" />
      <div className="relative mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Icon className="h-4.5 w-4.5" />
            </span>
            {title}
          </h3>
          {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="relative">{children}</div>
    </div>
  );

  const ChartState = ({
    loading: isLoading,
    empty,
    height = 220,
  }: {
    loading: boolean;
    empty?: boolean;
    height?: number;
  }) => (
    <div className="flex items-center justify-center" style={{ height }}>
      <div className="flex flex-col items-center gap-3 text-center">
        {isLoading ? (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
            <div className="text-sm font-medium text-foreground">加载中...</div>
            <div className="text-xs text-muted-foreground">正在准备统计数据</div>
          </>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-border/60 bg-background/40">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-sm font-medium text-foreground">{t('common.noData')}</div>
            {empty ? <div className="text-xs text-muted-foreground">当前还没有可展示的统计记录</div> : null}
          </>
        )}
      </div>
    </div>
  );

  const SectionShell = ({
    title,
    icon: Icon,
    description,
    children,
  }: {
    title: string;
    icon: any;
    description?: string;
    children: ReactNode;
  }) => (
    <section className="relative overflow-hidden rounded-[28px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] px-6 py-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.10),transparent_28%),radial-gradient(circle_at_20%_80%,rgba(139,92,246,0.10),transparent_26%)]" />
      <div className="relative mb-5 flex items-start gap-4">
        <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{title}</h2>
          {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="relative">{children}</div>
    </section>
  );

  const ModernTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color?: string; payload?: any }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="min-w-[180px] rounded-xl border border-border/60 bg-background/95 px-3 py-2.5 shadow-xl backdrop-blur">
        <div className="mb-2 text-xs font-medium text-foreground">{label}</div>
        <div className="space-y-1.5">
          {payload.map((entry, index) => (
            <div key={`${entry.name}-${index}`} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color || CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] }} />
                <span>{entry.name}</span>
              </div>
              <span className="font-medium text-foreground">{formatTokens(Number(entry.value || 0))}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const UserTokenPieChart = ({ title, items }: { title: string; items: TokenRankingItem[] }) => {
    const pieData = items.map((item) => ({
      name: item.name || item.configFile || '-',
      value: item.totalTokens,
      cost: item.cost,
      runs: item.runs,
    }));
    const total = pieData.reduce((sum, d) => sum + d.value, 0);

    return (
      <ChartShell
        title={title}
        icon={Cpu}
        description={t('dashboard.tokenRanking.userSubtitle')}
        className="h-full"
      >
        {loading ? (
          <ChartState loading height={180} />
        ) : items.length > 0 ? (
          <div className="flex items-center gap-4">
            <div className="w-[180px] h-[180px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<ModernTooltip />}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              {pieData.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="truncate flex-1">{d.name}</span>
                  <span className="shrink-0 font-medium">{formatTokens(d.value)}</span>
                  <span className="shrink-0 text-muted-foreground">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ChartState loading={false} empty height={180} />
        )}
      </ChartShell>
    );
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-2000" />
      </div>

      {/* Grid overlay */}
      <div className="fixed inset-0 z-0 opacity-20">
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(hsl(var(--primary) / 0.1) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.1) 1px, transparent 1px)',
          backgroundSize: '50px 50px',
        }} />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <motion.header
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50"
        >
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <RobotLogo size={48} />
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                    {t('dashboard.title')}
                  </h1>
                  <p className="text-xs text-muted-foreground">{t('dashboard.subtitle')}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {t('dashboard.versionLabel')} v{pkgJson.version}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" onClick={() => router.push('/')} title={t('dashboard.quickActions.chatMode')}>
                  <span className="material-symbols-outlined text-sm mr-1">chat</span>
                  {t('dashboard.quickActions.chatMode')}
                </Button>
                <LanguageToggle />
                <ThemeToggle />
                <UserMenu user={currentUser} />
              </div>
            </div>
          </div>
        </motion.header>

        <div className="container mx-auto px-6 py-8 space-y-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              icon={Workflow}
              label={t('dashboard.stats.activeWorkflows')}
              value={stats.activeWorkflows}
              color="from-blue-500 to-blue-600"
            />
            <StatCard
              icon={Activity}
              label={t('dashboard.stats.weeklyRuns')}
              value={stats.weeklyRuns}
              color="from-green-500 to-green-600"
            />
            <StatCard
              icon={Cpu}
              label={t('dashboard.stats.tokenConsumption')}
              value={formatTokens(stats.totalTokenUsage)}
              color="from-purple-500 to-purple-600"
            />
            <StatCard
              icon={TrendingUp}
              label={t('dashboard.stats.weeklyTokenConsumption')}
              value={formatTokens(stats.weeklyTokenUsage)}
              color="from-orange-500 to-orange-600"
            />
          </div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              {t('dashboard.quickActions.title')}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                <QuickAction
                  icon={Play}
                  label={t('dashboard.quickActions.newWorkflow')}
                  desc={t('dashboard.quickActions.newWorkflowDesc')}
                  onClick={() => setShowNewModal(true)}
                  color="from-blue-500 to-blue-600"
                />
                <QuickAction
                  icon={Workflow}
                  label={t('dashboard.quickActions.workflows')}
                  desc={t('dashboard.quickActions.workflowsDesc')}
                  onClick={() => router.push('/workflows')}
                  color="from-cyan-500 to-cyan-600"
                />
                <QuickAction
                  icon={Bot}
                  label={t('dashboard.quickActions.manageAgents')}
                  desc={t('dashboard.quickActions.manageAgentsDesc')}
                  onClick={() => router.push('/agents')}
                  color="from-purple-500 to-purple-600"
                />
                <QuickAction
                  icon={Settings}
                  label={t('dashboard.quickActions.models')}
                  desc={t('dashboard.quickActions.modelsDesc')}
                  onClick={() => router.push('/models')}
                  color="from-orange-500 to-orange-600"
                />
                <QuickAction
                  icon={Package}
                  label={t('dashboard.quickActions.skills')}
                  desc={t('dashboard.quickActions.skillsDesc')}
                  onClick={() => router.push('/skills')}
                  color="from-pink-500 to-pink-600"
                />
                <QuickAction
                  icon={Cog}
                  label={t('dashboard.quickActions.engines')}
                  desc={t('dashboard.quickActions.enginesDesc')}
                  onClick={() => router.push('/engines')}
                  color="from-indigo-500 to-indigo-600"
                />
                <QuickAction
                  icon={Clock}
                  label={t('dashboard.quickActions.schedules')}
                  desc={t('dashboard.quickActions.schedulesDesc')}
                  onClick={() => router.push('/schedules')}
                  color="from-teal-500 to-teal-600"
                />
                <QuickAction
                  icon={Key}
                  label={t('dashboard.quickActions.envVars')}
                  desc={t('dashboard.quickActions.envVarsDesc')}
                  onClick={() => router.push('/account/system-settings')}
                  color="from-amber-500 to-amber-600"
                />
                <QuickAction
                  icon={NotebookTabs}
                  label={t('dashboard.quickActions.knowledge')}
                  desc={t('dashboard.quickActions.knowledgeDesc')}
                  onClick={() => router.push('/knowledge')}
                  color="from-emerald-500 to-emerald-600"
                />
                <QuickAction
                  icon={FileText}
                  label={t('dashboard.quickActions.apiDocs')}
                  desc={t('dashboard.quickActions.apiDocsDesc')}
                  onClick={() => router.push('/api-docs')}
                  color="from-green-500 to-green-600"
                />
            </div>
          </motion.div>

          {/* Runtime Analytics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <SectionShell
              title={t('dashboard.charts.runtimeSectionTitle')}
              icon={Activity}
              description={t('dashboard.charts.runtimeSectionDesc')}
            >
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="xl:col-span-5">
                  <ChartShell
                    title={t('dashboard.charts.agentUsage')}
                    icon={Bot}
                    description={t('dashboard.charts.agentUsageDesc')}
                    className="h-full"
                  >
                    {loading ? (
                      <ChartState loading height={280} />
                    ) : agentCallsChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={agentCallsChartData} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid horizontal strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                          <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                          <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={100} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                          <Tooltip content={<ModernTooltip />} />
                          <Bar dataKey="calls" name={t('dashboard.charts.calls')} radius={[0, 10, 10, 0]}>
                            {agentCallsChartData.map((entry, index) => (
                              <Cell key={`${entry.name}-${index}`} fill={entry.fill || CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <ChartState loading={false} empty height={280} />
                    )}
                  </ChartShell>
                </div>
                <div className="xl:col-span-7">
                  <ChartShell
                    title={t('dashboard.charts.weeklyActivity')}
                    icon={Activity}
                    description={t('dashboard.charts.weeklyActivityDesc')}
                    className="h-full"
                  >
                    {loading ? (
                      <ChartState loading height={280} />
                    ) : activityChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={activityChartData}>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip content={<ModernTooltip />} />
                          <Bar dataKey="runs" name={t('dashboard.charts.runs')} radius={[10, 10, 0, 0]}>
                            {activityChartData.map((entry, index) => (
                              <Cell key={`${entry.name}-${index}`} fill={entry.fill || CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <ChartState loading={false} empty height={280} />
                    )}
                  </ChartShell>
                </div>
              </div>
            </SectionShell>
          </motion.div>

          {/* Workflows and Recent Runs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {/* Workflows */}
            <div className="xl:col-span-5">
            <ChartShell
              title={t('dashboard.sections.activeWorkflows')}
              icon={Workflow}
              description={t('dashboard.sections.activeWorkflowsDesc')}
              className="h-full"
            >
              <div className="space-y-3">
                {runningRuns.slice(0, 5).map((run, i) => {
                  const config = configs.find(c => c.filename === run.configFile);
                  const configName = config?.name || run.configName || run.configFile;

                  return (
                    <motion.div
                      key={run.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.35 + i * 0.06 }}
                      whileHover={{ x: 4 }}
                      className="group flex items-center justify-between rounded-2xl border border-border/50 bg-background/55 p-3.5 shadow-sm transition-all hover:border-primary/35 hover:bg-background/72"
                      onClick={() => router.push(`/workbench/${encodeURIComponent(run.configFile)}?mode=history&runId=${run.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/15">
                          <Play className="h-4 w-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium">{configName}</span>
                          <span className="text-xs text-muted-foreground">{formatStateName(run.currentPhase || '') || 'Starting...'}</span>
                        </div>
                      </div>
                      <Badge variant="secondary" className="rounded-full px-3 py-1">{run.completedSteps || 0}/{run.totalSteps || 0}</Badge>
                    </motion.div>
                  );
                })}
                {runningRuns.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-border/60 py-10 text-center text-muted-foreground">
                    {t('dashboard.sections.noActiveWorkflows')}
                  </div>
                )}
              </div>
            </ChartShell>
            </div>

            {/* Recent Runs */}
            <div className="xl:col-span-7">
            <ChartShell
              title={t('dashboard.sections.recentRuns')}
              icon={History}
              description={t('dashboard.sections.recentRunsDesc')}
              action={
                <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs" asChild>
                  <Link href="/run-history">查看全部</Link>
                </Button>
              }
              className="h-full"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <Link href="/run-history" className="inline-flex items-center gap-2 text-lg font-semibold transition-colors hover:text-primary">
                  <History className="w-5 h-5 text-primary" />
                  <span>{t('dashboard.sections.recentRuns')}</span>
                </Link>
                <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">{recentRuns.length}</Badge>
              </div>
              <div className="space-y-3">
                {recentRuns.map((run, i) => (
                  <motion.div
                    key={run.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.06 }}
                    onClick={() => router.push(`/workbench/${encodeURIComponent(run.configFile)}?mode=history&runId=${run.id}`)}
                    className="group flex items-center justify-between rounded-2xl border border-border/50 bg-background/55 p-3.5 shadow-sm transition-all hover:border-primary/35 hover:bg-background/72"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                        {run.status === 'completed' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : run.status === 'failed' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : run.status === 'running' ? (
                          <Play className="h-4 w-4 text-blue-500" />
                        ) : run.status === 'stopped' ? (
                          <AlertCircle className="h-4 w-4 text-gray-500" />
                        ) : run.status === 'crashed' ? (
                          <XCircle className="h-4 w-4 text-orange-500" />
                        ) : (
                          <Clock className="h-4 w-4 text-yellow-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{run.configName || run.configFile}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatStateName(run.currentPhase || '') || t('dashboard.starting')}</span>
                          <span className="h-1 w-1 rounded-full bg-border" />
                          <span>{new Date(run.startTime).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {typeof run.totalTokens === 'number' ? (
                        <div className="hidden text-right md:block">
                          <div className="text-sm font-semibold">{formatTokens(run.totalTokens)}</div>
                          <div className="text-[11px] text-muted-foreground">{t('dashboard.tokenRanking.totalTokens')}</div>
                        </div>
                      ) : (
                        null
                      )}
                      <Badge variant={run.status === 'completed' ? 'default' : 'secondary'} className="rounded-full px-3 py-1">
                        {t(`dashboard.status.${run.status}`)}
                      </Badge>
                    </div>
                  </motion.div>
                ))}
              </div>
            </ChartShell>
            </div>
          </div>
          </motion.div>

          {/* Token Analytics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <SectionShell
              title={t('dashboard.tokenRanking.title')}
              icon={TrendingUp}
              description={t('dashboard.tokenRanking.sectionSubtitle')}
            >
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="xl:col-span-8">
                  <ChartShell
                    title={t('dashboard.charts.workflowTokenComparison')}
                    icon={Layers3}
                    description={t('dashboard.charts.workflowTokenComparisonDesc')}
                    action={
                      <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                        Top {workflowComparisonData.length || 0}
                      </Badge>
                    }
                    className="h-full"
                  >
                    {loading ? (
                      <ChartState loading height={396} />
                    ) : workflowComparisonData.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4">
                        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_220px] 2xl:items-end">
                          <ResponsiveContainer width="100%" height={252}>
                            <BarChart data={workflowComparisonData} barGap={10} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.25} />
                              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} interval={0} height={52} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => formatTokens(Number(value))} />
                              <Tooltip content={<ModernTooltip />} />
                              <Bar dataKey="inputTokens" name={t('dashboard.charts.inputTokens')} stackId="tokens" fill={TOKEN_STACK_COLORS.inputTokens} radius={[8, 8, 0, 0]} />
                              <Bar dataKey="outputTokens" name={t('dashboard.charts.outputTokens')} stackId="tokens" fill={TOKEN_STACK_COLORS.outputTokens} radius={[0, 0, 0, 0]} />
                              <Bar dataKey="cacheTokens" name={t('dashboard.charts.cacheTokens')} stackId="tokens" fill={TOKEN_STACK_COLORS.cacheTokens} radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                          <div className="grid content-end gap-2">
                            {[
                              { label: t('dashboard.charts.inputTokens'), color: TOKEN_STACK_COLORS.inputTokens },
                              { label: t('dashboard.charts.outputTokens'), color: TOKEN_STACK_COLORS.outputTokens },
                              { label: t('dashboard.charts.cacheTokens'), color: TOKEN_STACK_COLORS.cacheTokens },
                            ].map((item) => (
                              <div key={item.label} className="inline-flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                                <div className="inline-flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                                  {item.label}
                                </div>
                                <span className="text-[11px] text-foreground/70">
                                  {formatTokens(
                                    workflowComparisonData.reduce((sum, row) => sum + Number(
                                      item.label === t('dashboard.charts.inputTokens')
                                        ? row.inputTokens
                                        : item.label === t('dashboard.charts.outputTokens')
                                          ? row.outputTokens
                                          : row.cacheTokens
                                    ), 0)
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                          <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-foreground">{t('dashboard.charts.recentTokenTrend')}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{t('dashboard.charts.recentTokenTrendDesc')}</div>
                              </div>
                              <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                                {recentTokenTrendData.length} runs
                              </Badge>
                            </div>
                            {recentTokenTrendData.length > 0 ? (
                              <ResponsiveContainer width="100%" height={120}>
                                <AreaChart data={recentTokenTrendData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="recentTokenTrendFill" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.38} />
                                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.04} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.18} />
                                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                                  <YAxis hide />
                                  <Tooltip content={<ModernTooltip />} />
                                  <Area
                                    type="monotone"
                                    dataKey="totalTokens"
                                    name={t('dashboard.tokenRanking.totalTokens')}
                                    stroke="#38bdf8"
                                    strokeWidth={2}
                                    fill="url(#recentTokenTrendFill)"
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            ) : (
                              <ChartState loading={false} empty height={120} />
                            )}
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-foreground">{t('dashboard.charts.weeklyTokenTrend')}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{t('dashboard.charts.weeklyTokenTrendDesc')}</div>
                              </div>
                              <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                                7d
                              </Badge>
                            </div>
                            {tokenActivityData.length > 0 ? (
                              <ResponsiveContainer width="100%" height={120}>
                                <AreaChart data={tokenActivityData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="weeklyTokenTrendFill" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.34} />
                                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.18} />
                                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                                  <YAxis hide />
                                  <Tooltip content={<ModernTooltip />} />
                                  <Area
                                    type="monotone"
                                    dataKey="totalTokens"
                                    name={t('dashboard.charts.weeklyTokenTrend')}
                                    stroke="#8b5cf6"
                                    strokeWidth={2}
                                    fill="url(#weeklyTokenTrendFill)"
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            ) : (
                              <ChartState loading={false} empty height={120} />
                            )}
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/45 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-foreground">{t('dashboard.charts.tokenComposition')}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{t('dashboard.charts.tokenCompositionDesc')}</div>
                              </div>
                              <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                                {formatTokens(tokenCompositionData.reduce((sum, item) => sum + item.value, 0))}
                              </Badge>
                            </div>
                            {tokenCompositionData.length > 0 ? (
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
                                <div className="mx-auto h-[150px] w-[150px]">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                      <Pie
                                        data={tokenCompositionData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={40}
                                        outerRadius={62}
                                        paddingAngle={2}
                                        dataKey="value"
                                        stroke="none"
                                      >
                                        {tokenCompositionData.map((entry, index) => (
                                          <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                                        ))}
                                      </Pie>
                                      <Tooltip content={<ModernTooltip />} />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </div>
                                <div className="space-y-2">
                                  {tokenCompositionData.map((item) => {
                                    const total = tokenCompositionData.reduce((sum, entry) => sum + entry.value, 0) || 1;
                                    const percent = Math.round((item.value / total) * 100);
                                    return (
                                      <div key={item.name} className="rounded-xl border border-border/50 bg-background/55 px-3 py-2.5">
                                        <div className="flex items-center justify-between gap-3 text-xs">
                                          <div className="inline-flex items-center gap-2 text-muted-foreground">
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                                            <span>{item.name}</span>
                                          </div>
                                          <span className="font-medium text-foreground">{percent}%</span>
                                        </div>
                                        <div className="mt-1.5 text-sm font-semibold">{formatTokens(item.value)}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <ChartState loading={false} empty height={150} />
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <ChartState loading={false} empty height={396} />
                    )}
                  </ChartShell>
                </div>
                <div className="grid gap-6 xl:col-span-4">
                  <div className="grid grid-cols-1 gap-6">
                    <UserTokenPieChart title={t('dashboard.tokenRanking.byUser')} items={tokenRankingByUser} />
                    <ChartShell
                      title={t('dashboard.charts.runTokenRanking')}
                      icon={Trophy}
                      description={t('dashboard.charts.runTokenRankingDesc')}
                      action={
                        <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs" asChild>
                          <Link href="/run-history">查看运行记录</Link>
                        </Button>
                      }
                      className="h-full"
                    >
                      {loading ? (
                        <ChartState loading height={220} />
                      ) : runRankingChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={runRankingChartData} layout="vertical" margin={{ top: 8, right: 12, left: 16, bottom: 0 }} barCategoryGap={14}>
                            <CartesianGrid horizontal strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                            <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => formatTokens(Number(value))} />
                            <YAxis type="category" dataKey="name" width={110} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                            <Tooltip content={<ModernTooltip />} />
                            <Bar dataKey="totalTokens" name={t('dashboard.tokenRanking.totalTokens')} radius={[0, 10, 10, 0]}>
                              {runRankingChartData.map((entry, index) => (
                                <Cell key={`${entry.name}-${index}`} fill={CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <ChartState loading={false} empty height={220} />
                      )}
                    </ChartShell>
                  </div>
                  <TokenRankingList
                    title={t('dashboard.tokenRanking.byWorkflow')}
                    items={tokenRankingByWorkflow}
                    actionHref={WORKFLOW_TOKEN_RANKING_HREF}
                    actionLabel={t('dashboard.tokenRanking.viewAll')}
                  />
                </div>
              </div>
            </SectionShell>
          </motion.div>
        </div>
      </div>

      {showNewModal && (
        <NewConfigModal
          isOpen={showNewModal}
          onClose={() => setShowNewModal(false)}
          onSuccess={(filename) => {
            setShowNewModal(false);
            router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
          }}
        />
      )}
    </div>
  );
}
