'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Zap, Cpu, TrendingUp, Clock, CheckCircle2, XCircle, AlertCircle, Workflow, Bot, Settings, Play, Package, Cog, FileText, History, Key, NotebookTabs } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import NewConfigModal from '@/components/NewConfigModal';
import UserMenu from '@/components/UserMenu';
import { RobotLogo } from '@/components/chat/ChatMessage';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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
  const [currentUser, setCurrentUser] = useState<{ username: string; email: string; role: 'admin' | 'user'; avatar?: string } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('auth-user');
      if (stored) setCurrentUser(JSON.parse(stored));
    } catch {}
  }, []);

  const CACHE_KEY = 'dashboard-cache';
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    // Try to load from cache first for instant render
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts < CACHE_TTL) {
          setStats(cached.stats);
          setConfigs(cached.configs);
          setRecentRuns(cached.recentRuns);
          setRunningRuns(cached.runningRuns);
          setAgentUsageData(cached.agentUsageData || []);
          setActivityData(cached.activityData || []);
          setTokenRankingByUser(cached.tokenRankingByUser || []);
          setTokenRankingByWorkflow(cached.tokenRankingByWorkflow || []);
          setLoading(false);
        }
      }
    } catch {}
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const weekDays = [0,1,2,3,4,5,6].map(i => t(`dashboard.weekdays.${i}`));
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

      // Handle null or missing data gracefully
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

      // Map server dayOfWeek to localized weekday names
      const actData = (data.activityData || []).map((d: any) => ({
        name: weekDays[d.dayOfWeek],
        runs: d.runs,
      }));
      setActivityData(actData);

      // Write cache for instant render on next visit
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          stats: data.stats,
          configs: data.configs || [],
          recentRuns: data.recentRuns || [],
          runningRuns: data.runningRuns || [],
          agentUsageData: data.agentUsageData || [],
          tokenRankingByUser: data.tokenRankingByUser || [],
          tokenRankingByWorkflow: data.tokenRankingByWorkflow || [],
          activityData: actData,
        }));
      } catch {}

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const TokenRankingList = ({ title, items }: { title: string; items: TokenRankingItem[] }) => (
    <div className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Cpu className="w-5 h-5 text-primary" />
        {title}
      </h3>
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item, index) => {
            const cacheTokens = (item.cacheCreationInputTokens || 0) + (item.cacheReadInputTokens || 0);
            return (
              <div key={`${item.configFile || item.name}-${index}`} className="rounded-lg border border-border/30 bg-muted/40 p-3">
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
        <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
          {t('common.noData')}
        </div>
      )}
    </div>
  );

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

          {/* Token Ranking */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              {t('dashboard.tokenRanking.title')}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TokenRankingList title={t('dashboard.tokenRanking.byUser')} items={tokenRankingByUser} />
              <TokenRankingList title={t('dashboard.tokenRanking.byWorkflow')} items={tokenRankingByWorkflow} />
            </div>
          </motion.div>

          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
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
                  label={t('dashboard.quickActions.globalNotebook')}
                  desc={t('dashboard.quickActions.globalNotebookDesc')}
                  onClick={() => router.push('/notebook?notebook=1&notebookScope=global')}
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

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Agent Usage Chart */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" />
                {t('dashboard.charts.agentUsage')}
              </h3>
              {agentUsageData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={agentUsageData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} width={100} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: any, name?: string | number) => [value, name === 'calls' ? t('dashboard.charts.calls') : t('dashboard.charts.cost')]}
                    />
                    <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                  {t('common.noData')}
                </div>
              )}
            </motion.div>

            {/* Activity Chart */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                {t('dashboard.charts.weeklyActivity')}
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={activityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="runs" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          </div>

          {/* Workflows and Recent Runs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Workflows */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Workflow className="w-5 h-5 text-primary" />
                {t('dashboard.sections.activeWorkflows')}
              </h3>
              <div className="space-y-3">
                {runningRuns.slice(0, 5).map((run, i) => {
                  const config = configs.find(c => c.filename === run.configFile);
                  const configName = config?.name || run.configName || run.configFile;

                  return (
                    <motion.div
                      key={run.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + i * 0.1 }}
                      whileHover={{ x: 5 }}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border/30 cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => router.push(`/workbench/${encodeURIComponent(run.configFile)}?mode=history&runId=${run.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <div className="flex flex-col">
                          <span className="font-medium">{configName}</span>
                          <span className="text-xs text-muted-foreground">{formatStateName(run.currentPhase || '') || 'Starting...'}</span>
                        </div>
                      </div>
                      <Badge variant="secondary">{run.completedSteps || 0}/{run.totalSteps || 0}</Badge>
                    </motion.div>
                  );
                })}
                {runningRuns.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    {t('dashboard.sections.noActiveWorkflows')}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Recent Runs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-6"
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                {t('dashboard.sections.recentRuns')}
              </h3>
              <div className="space-y-3">
                {recentRuns.map((run, i) => (
                  <motion.div
                    key={run.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.7 + i * 0.1 }}
                    onClick={() => router.push(`/workbench/${encodeURIComponent(run.configFile)}?mode=history&runId=${run.id}`)}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border/30 cursor-pointer hover:bg-muted/70 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {run.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : run.status === 'failed' ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : run.status === 'running' ? (
                        <Play className="w-4 h-4 text-blue-500" />
                      ) : run.status === 'stopped' ? (
                        <AlertCircle className="w-4 h-4 text-gray-500" />
                      ) : run.status === 'crashed' ? (
                        <XCircle className="w-4 h-4 text-orange-500" />
                      ) : (
                        <Clock className="w-4 h-4 text-yellow-500" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{run.configName || run.configFile}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatStateName(run.currentPhase || '') || t('dashboard.starting')} · {new Date(run.startTime).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <Badge variant={run.status === 'completed' ? 'default' : 'secondary'}>
                      {t(`dashboard.status.${run.status}`)}
                    </Badge>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
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
