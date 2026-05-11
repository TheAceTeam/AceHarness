'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Download,
  FolderOpen,
  Puzzle,
  Search,
  Store,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useToast } from '@/components/ui/toast';
import Markdown from '@/components/Markdown';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import {
  SkillCard,
  SkillSearch,
  InstallProgress,
  SkillDetail,
  Pagination,
} from '@/components/marketplace';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MarketplaceSkill, InstallProgress as InstallProgressType } from '@/types/marketplace';
import { DEFAULT_PAGE_SIZE } from '@/constants/marketplace';

interface LocalSkill {
  name: string;
  path: string;
  description: string;
  descriptionZh?: string;
  tags: string[];
  platforms?: string[];
  version?: string;
  updatedAt?: string;
  contributors?: string[];
  detailedDescription?: string;
  source?: string;
  hasPromptMd?: boolean;
}

interface SyncStatus {
  inInstall: boolean;
  aceharnessBuiltin: boolean;
}

type TabType = 'local' | 'online';
type ViewMode = 'gallery' | 'table';
type LocalSortKey = 'name' | 'updatedAt' | 'source';
type SortDirection = 'asc' | 'desc';

const LOCAL_VIEW_MODE_KEY = 'aceharness:skills:local-view-mode';
const ONLINE_VIEW_MODE_KEY = 'aceharness:skills:online-view-mode';
const LOCAL_PAGE_SIZE_KEY = 'aceharness:skills:local-page-size';
const ONLINE_PAGE_SIZE_KEY = 'aceharness:skills:online-page-size';
const ACTIVE_TAB_KEY = 'aceharness:skills:active-tab';
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];

const SOURCE_COLORS: Record<string, string> = {
  'ace-custom': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  anthropics: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

const DEFAULT_SOURCE_COLOR = 'bg-slate-500/20 text-slate-300 border-slate-500/30';

const SOURCE_LABELS: Record<string, string> = {
  'ace-custom': 'ACE 自定义',
  anthropics: 'Anthropics',
};

const SOURCE_ORDER = ['ace-custom', 'anthropics'];

function normalizeSkillSource(skill: Pick<LocalSkill, 'source'>): string {
  return skill.source?.trim() === 'anthropics' ? 'anthropics' : 'ace-custom';
}

function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source;
}

function formatLocalUpdatedAt(value?: string): string {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOnlineUpdatedAt(value?: string): string {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function normalizeMarketplaceSkillKey(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, '')
    .replace(/[_\s]+/g, '-');
}

export default function SkillsPage() {
  const { toast } = useToast();
  useDocumentTitle('Skills 管理');

  const [activeTab, setActiveTab] = useState<TabType>('local');

  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<LocalSkill | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [runtimeSkillsDir, setRuntimeSkillsDir] = useState('');
  const [installSkillsDir, setInstallSkillsDir] = useState('');
  const [installSkills, setInstallSkills] = useState<LocalSkill[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [syncingAllBuiltin, setSyncingAllBuiltin] = useState(false);
  const [syncingSkillNames, setSyncingSkillNames] = useState<Set<string>>(new Set());
  const [localViewMode, setLocalViewMode] = useState<ViewMode>('table');
  const [localSortKey, setLocalSortKey] = useState<LocalSortKey>('updatedAt');
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>('desc');
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(DEFAULT_PAGE_SIZE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [onlineSkills, setOnlineSkills] = useState<MarketplaceSkill[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [onlineViewMode, setOnlineViewMode] = useState<ViewMode>('gallery');
  const [onlinePage, setOnlinePage] = useState(1);
  const [onlinePageSize, setOnlinePageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalItems, setTotalItems] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgressType>({
    skillName: '',
    status: 'downloading',
    progress: 0,
    message: '',
  });
  const [selectedOnlineSkill, setSelectedOnlineSkill] = useState<MarketplaceSkill | null>(null);

  useEffect(() => {
    try {
      const savedActiveTab = localStorage.getItem(ACTIVE_TAB_KEY);
      if (savedActiveTab === 'local' || savedActiveTab === 'online') {
        setActiveTab(savedActiveTab);
      }
      const savedLocalViewMode = localStorage.getItem(LOCAL_VIEW_MODE_KEY);
      if (savedLocalViewMode === 'gallery' || savedLocalViewMode === 'table') {
        setLocalViewMode(savedLocalViewMode);
      }
      const savedOnlineViewMode = localStorage.getItem(ONLINE_VIEW_MODE_KEY);
      if (savedOnlineViewMode === 'gallery' || savedOnlineViewMode === 'table') {
        setOnlineViewMode(savedOnlineViewMode);
      }
      const savedLocalPageSize = Number(localStorage.getItem(LOCAL_PAGE_SIZE_KEY) || DEFAULT_PAGE_SIZE);
      if (PAGE_SIZE_OPTIONS.includes(savedLocalPageSize)) setLocalPageSize(savedLocalPageSize);
      const savedOnlinePageSize = Number(localStorage.getItem(ONLINE_PAGE_SIZE_KEY) || DEFAULT_PAGE_SIZE);
      if (PAGE_SIZE_OPTIONS.includes(savedOnlinePageSize)) setOnlinePageSize(savedOnlinePageSize);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_TAB_KEY, activeTab); } catch {}
  }, [activeTab]);

  useEffect(() => {
    try { localStorage.setItem(LOCAL_VIEW_MODE_KEY, localViewMode); } catch {}
  }, [localViewMode]);

  useEffect(() => {
    try { localStorage.setItem(ONLINE_VIEW_MODE_KEY, onlineViewMode); } catch {}
  }, [onlineViewMode]);

  useEffect(() => {
    try { localStorage.setItem(LOCAL_PAGE_SIZE_KEY, String(localPageSize)); } catch {}
  }, [localPageSize]);

  useEffect(() => {
    try { localStorage.setItem(ONLINE_PAGE_SIZE_KEY, String(onlinePageSize)); } catch {}
  }, [onlinePageSize]);

  useEffect(() => {
    setLocalPage(1);
  }, [searchQuery, selectedSource, selectedTags, localSortKey, localSortDirection, localPageSize]);

  useEffect(() => {
    setOnlinePage(1);
  }, [searchKeyword, selectedCategory, onlinePageSize]);

  useEffect(() => {
    if (activeTab === 'local') {
      void loadSkills();
      return;
    }
    void loadCategories();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'online') return;

    setOnlineLoading(true);
    setOnlineError(null);

    const fetchSkills = async () => {
      try {
        const response = await fetch('/api/marketplace/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: searchKeyword,
            category: selectedCategory,
            pageNum: onlinePage,
            pageSize: onlinePageSize,
          }),
        });
        const data = await response.json();
        if (data.success) {
          setOnlineSkills(data.data.skills || []);
          setTotalItems(data.data.total || 0);
        } else {
          setOnlineError(data.error || '加载应用市场失败');
        }
      } catch {
        setOnlineError('加载应用市场失败');
      } finally {
        setOnlineLoading(false);
      }
    };

    void fetchSkills();
  }, [activeTab, searchKeyword, selectedCategory, onlinePage, onlinePageSize]);

  const loadSkills = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/skills');
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSkills(data.skills || []);
        setInstallSkills(data.installSkills || []);
        setRuntimeSkillsDir(data.runtimeSkillsDir || '');
        setInstallSkillsDir(data.installSkillsDir || '');
      }
    } catch {
      setError('加载 skills 失败');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch('/api/marketplace/categories');
      const data = await response.json();
      if (data.success) {
        setCategories(data.data.categories || []);
      }
    } catch {}
  };

  const handleUploadZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/skills', { method: 'POST', body: formData });
      const data = await response.json();
      if (data.success) {
        toast('success', data.message || '导入成功');
        await loadSkills();
      } else {
        toast('error', data.error || '导入失败');
      }
    } catch {
      toast('error', '导入失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    if (selectedForExport.size === 0) {
      toast('error', '请先选择要导出的 Skill');
      return;
    }
    setExporting(true);
    try {
      const response = await fetch('/api/skills', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: Array.from(selectedForExport) }),
      });
      if (!response.ok) {
        const data = await response.json();
        toast('error', data.error || '导出失败');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skills-export.zip';
      a.click();
      URL.revokeObjectURL(url);
      toast('success', `已导出 ${selectedForExport.size} 个 Skill`);
    } catch {
      toast('error', '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const toggleExportSelection = (name: string) => {
    setSelectedForExport((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const syncInstalledSkills = async (skillNames: string[], successMessage?: string) => {
    const names = Array.from(new Set(skillNames.filter(Boolean)));
    if (names.length === 0) {
      toast('warning', '安装目录中没有可同步的 Skill');
      return false;
    }

    setSyncingSkillNames((prev) => {
      const next = new Set(prev);
      names.forEach((name) => next.add(name));
      return next;
    });

    try {
      const response = await fetch('/api/skills', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: names }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        toast('error', data.error || '同步失败');
        return false;
      }

      toast('success', successMessage || data.message || '同步成功');
      await loadSkills();
      return true;
    } catch {
      toast('error', '同步失败');
      return false;
    } finally {
      setSyncingSkillNames((prev) => {
        const next = new Set(prev);
        names.forEach((name) => next.delete(name));
        return next;
      });
    }
  };

  const handleSyncBuiltinAceharnessSkills = async () => {
    const targetNames = installSkills
      .map((skill) => skill.path)
      .filter((name) => name.startsWith('aceharness-'));
    setSyncingAllBuiltin(true);
    try {
      await syncInstalledSkills(targetNames, `已同步 ${targetNames.length} 个 aceharness 内置 Skill`);
    } finally {
      setSyncingAllBuiltin(false);
    }
  };

  const handleInstall = async (skillName: string) => {
    setSelectedOnlineSkill(null);
    setInstalling(skillName);
    setInstallProgress({
      skillName,
      status: 'downloading',
      progress: 0,
      message: '开始下载...',
    });

    try {
      setInstallProgress((prev) => ({
        ...prev,
        progress: 30,
        message: '正在下载...',
      }));

      const response = await fetch('/api/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName }),
      });
      const data = await response.json();

      if (data.success) {
        setInstallProgress({
          skillName,
          status: 'success',
          progress: 100,
          message: '安装成功！',
        });
        setOnlineSkills((prev) =>
          prev.map((skill) => {
            const installName = skill.enName || skill.name;
            return installName === skillName ? { ...skill, installed: true } : skill;
          }),
        );
        setSelectedOnlineSkill((prev) => {
          if (!prev) return prev;
          const installName = prev.enName || prev.name;
          return installName === skillName ? { ...prev, installed: true } : prev;
        });
        toast('success', `Skill "${skillName}" 已成功安装`);
        await loadSkills();
      } else {
        setInstallProgress({
          skillName,
          status: 'error',
          progress: 100,
          message: data.error || '安装失败',
        });
      }
    } catch {
      setInstallProgress({
        skillName,
        status: 'error',
        progress: 100,
        message: '网络错误',
      });
    }
  };

  const allTags = useMemo(
    () => Array.from(new Set(skills.flatMap((skill) => skill.tags || []))).sort(),
    [skills],
  );

  const sourceKeys = useMemo(() => {
    return Array.from(new Set(skills.map(normalizeSkillSource))).sort((a, b) => {
      const aIndex = SOURCE_ORDER.indexOf(a);
      const bIndex = SOURCE_ORDER.indexOf(b);
      if (aIndex >= 0 || bIndex >= 0) {
        return (aIndex >= 0 ? aIndex : SOURCE_ORDER.length) - (bIndex >= 0 ? bIndex : SOURCE_ORDER.length);
      }
      return a.localeCompare(b);
    });
  }, [skills]);

  const sourceCounts = useMemo(() => {
    return skills.reduce<Record<string, number>>((acc, skill) => {
      const source = normalizeSkillSource(skill);
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});
  }, [skills]);

  const installSkillPathSet = useMemo(() => new Set(installSkills.map((skill) => skill.path)), [installSkills]);
  const installedSkillKeySet = useMemo(() => {
    const keys = new Set<string>();
    for (const skill of skills) {
      keys.add(normalizeMarketplaceSkillKey(skill.name));
      if (skill.path) {
        const normalizedPath = skill.path.replace(/\\/g, '/');
        const folderName = normalizedPath.split('/').filter(Boolean).pop();
        if (folderName) keys.add(normalizeMarketplaceSkillKey(folderName));
      }
    }
    for (const skill of installSkills) {
      keys.add(normalizeMarketplaceSkillKey(skill.name));
      if (skill.path) {
        const normalizedPath = skill.path.replace(/\\/g, '/');
        const folderName = normalizedPath.split('/').filter(Boolean).pop();
        if (folderName) keys.add(normalizeMarketplaceSkillKey(folderName));
      }
    }
    return keys;
  }, [installSkills, skills]);

  const syncStatusByName = useMemo(() => {
    return skills.reduce<Record<string, SyncStatus>>((acc, skill) => {
      const inInstall = installSkillPathSet.has(skill.path);
      acc[skill.name] = {
        inInstall,
        aceharnessBuiltin: inInstall && skill.path.startsWith('aceharness-'),
      };
      return acc;
    }, {});
  }, [skills, installSkillPathSet]);

  const builtinAceharnessInstallCount = useMemo(
    () => installSkills.filter((skill) => skill.path.startsWith('aceharness-')).length,
    [installSkills],
  );

  const filteredLocalSkills = useMemo(() => {
    return skills.filter((skill) => {
      if (selectedSource !== 'all' && normalizeSkillSource(skill) !== selectedSource) return false;
      if (selectedTags.length > 0 && !selectedTags.some((tag) => skill.tags?.includes(tag))) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        (skill.descriptionZh || '').toLowerCase().includes(q) ||
        skill.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [skills, selectedSource, selectedTags, searchQuery]);

  const sortedLocalSkills = useMemo(() => {
    const items = [...filteredLocalSkills];
    items.sort((a, b) => {
      let value = 0;
      if (localSortKey === 'name') {
        value = a.name.localeCompare(b.name, 'zh-CN');
      } else if (localSortKey === 'source') {
        value = getSourceLabel(normalizeSkillSource(a)).localeCompare(getSourceLabel(normalizeSkillSource(b)), 'zh-CN');
      } else {
        value = (Date.parse(a.updatedAt || '') || 0) - (Date.parse(b.updatedAt || '') || 0);
      }
      return localSortDirection === 'asc' ? value : -value;
    });
    return items;
  }, [filteredLocalSkills, localSortDirection, localSortKey]);

  const localPagination = useMemo(() => {
    const total = sortedLocalSkills.length;
    const totalPages = Math.max(1, Math.ceil(total / localPageSize));
    const safePage = Math.min(localPage, totalPages);
    const start = (safePage - 1) * localPageSize;
    const end = start + localPageSize;
    return {
      total,
      totalPages,
      page: safePage,
      pageSize: localPageSize,
      items: sortedLocalSkills.slice(start, end),
    };
  }, [localPage, localPageSize, sortedLocalSkills]);

  useEffect(() => {
    if (localPage !== localPagination.page) {
      setLocalPage(localPagination.page);
    }
  }, [localPage, localPagination.page]);

  const sortedOnlineSkills = useMemo(() => {
    return onlineSkills.map((skill) => ({
      ...skill,
      installed: skill.installed || installedSkillKeySet.has(normalizeMarketplaceSkillKey(skill.enName || skill.name)),
    }));
  }, [installedSkillKeySet, onlineSkills]);

  const localSummaryLabel = useMemo(() => {
    if (!localPagination.total) return '暂无 Skills';
    const start = (localPagination.page - 1) * localPagination.pageSize + 1;
    const end = Math.min(localPagination.page * localPagination.pageSize, localPagination.total);
    return `显示 ${start}-${end} / ${localPagination.total} 个 Skills`;
  }, [localPagination]);

  const onlineSummaryLabel = useMemo(() => {
    if (!totalItems) return '暂无应用市场 Skill';
    const start = (onlinePage - 1) * onlinePageSize + 1;
    const end = Math.min(onlinePage * onlinePageSize, totalItems);
    return `显示 ${start}-${end} / ${totalItems} 个 Skills`;
  }, [onlinePage, onlinePageSize, totalItems]);

  const getDisplayDescription = (skill: LocalSkill) => skill.descriptionZh || skill.description;

  const handleLocalSort = (key: LocalSortKey) => {
    if (localSortKey === key) {
      setLocalSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setLocalSortKey(key);
    setLocalSortDirection(key === 'updatedAt' ? 'desc' : 'asc');
  };

  const SortIcon = ({
    active,
    direction,
  }: {
    active: boolean;
    direction: SortDirection;
  }) => {
    if (!active) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return direction === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  返回首页
                </Link>
              </Button>
              <div className="h-6 w-px bg-border" />
              <div>
                <h1 className="text-2xl font-bold">Skills 管理</h1>
                <p className="text-xs text-muted-foreground">统一管理本地 Skills 与应用市场安装</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {activeTab === 'local' ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={handleUploadZip}
                  />
                  <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    <Upload className={`w-4 h-4 mr-1 ${uploading ? 'animate-bounce' : ''}`} />
                    {uploading ? '导入中...' : '上传 Skill'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting || selectedForExport.size === 0}>
                    <Download className={`w-4 h-4 mr-1 ${exporting ? 'animate-bounce' : ''}`} />
                    {exporting ? '导出中...' : `导出 (${selectedForExport.size})`}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeSkillsDir}>
                    <FolderOpen className="w-4 h-4 mr-1" />
                    工作目录
                  </Button>
                </>
              ) : null}
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 flex flex-col gap-6">
        <section className="rounded-[24px] border border-border/70 bg-card/95 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={activeTab === 'local' ? 'default' : 'ghost'}
              className="rounded-full"
              onClick={() => setActiveTab('local')}
            >
              <Puzzle className="w-4 h-4 mr-2" />
              本地管理
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'online' ? 'default' : 'ghost'}
              className="rounded-full"
              onClick={() => setActiveTab('online')}
            >
              <Store className="w-4 h-4 mr-2" />
              Skill 广场
            </Button>
          </div>
        </section>

        {activeTab === 'local' ? (
          <>
            <section className="sticky top-[4.5rem] z-20 rounded-[28px] border border-border/70 bg-card/90 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur supports-[backdrop-filter]:bg-card/80">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
                  <div className="relative w-full max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="搜索 Skills..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-11 w-full rounded-2xl border-border/70 bg-background/80 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['all', ...sourceKeys] as string[]).map((source) => (
                      <Button
                        key={source}
                        size="sm"
                        variant={selectedSource === source ? 'default' : 'outline'}
                        className="rounded-full"
                        onClick={() => setSelectedSource(source)}
                      >
                        {source === 'all'
                          ? `全部 (${skills.length})`
                          : `${getSourceLabel(source)} (${sourceCounts[source] || 0})`}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{localSummaryLabel}</span>
                  {localViewMode === 'gallery' ? (
                    <>
                      <Select value={localSortKey} onValueChange={(value) => setLocalSortKey(value as LocalSortKey)}>
                        <SelectTrigger className="h-9 w-[140px] bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="updatedAt">按更新时间</SelectItem>
                          <SelectItem value="name">按名称</SelectItem>
                          <SelectItem value="source">按来源</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setLocalSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                      >
                        {localSortDirection === 'asc' ? '升序' : '降序'}
                      </Button>
                    </>
                  ) : null}
                  <Select value={String(localPageSize)} onValueChange={(value) => setLocalPageSize(Number(value))}>
                    <SelectTrigger className="h-9 w-[112px] bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option} / 页
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
                    <Button
                      size="sm"
                      variant={localViewMode === 'gallery' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => setLocalViewMode('gallery')}
                    >
                      <span className="material-symbols-outlined text-sm">grid_view</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={localViewMode === 'table' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => setLocalViewMode('table')}
                    >
                      <span className="material-symbols-outlined text-sm">table_rows</span>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedTags((prev) =>
                          prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
                        );
                      }}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSyncBuiltinAceharnessSkills}
                  disabled={syncingAllBuiltin || builtinAceharnessInstallCount === 0}
                >
                  {syncingAllBuiltin ? '同步中...' : `同步内置 Skills (${builtinAceharnessInstallCount})`}
                </Button>
              </div>

              {(runtimeSkillsDir || installSkillsDir) ? (
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                  {runtimeSkillsDir ? <div>Runtime 目录：{runtimeSkillsDir}</div> : null}
                  {installSkillsDir ? <div>安装目录：{installSkillsDir}</div> : null}
                </div>
              ) : null}
            </section>

            {runtimeSkillsDir ? (
              <WorkspaceEditor
                open={workspaceOpen}
                onOpenChange={setWorkspaceOpen}
                workspacePath={runtimeSkillsDir}
                title="Runtime Skills"
              />
            ) : null}

            <section className="rounded-[28px] border border-border/60 bg-card/80 p-4 shadow-sm">
              {loading ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                  <p className="text-destructive">{error}</p>
                  <Button onClick={() => void loadSkills()}>重试</Button>
                </div>
              ) : localPagination.total === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <Puzzle className="w-12 h-12 mb-4" />
                  <p>{searchQuery ? '没有匹配的 Skills' : '暂无 Skills'}</p>
                </div>
              ) : localViewMode === 'table' ? (
                <div className="overflow-hidden rounded-[24px] border border-border/70 bg-background/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>选择</TableHead>
                        <TableHead className="w-[180px] min-w-[180px]">
                          <button className="inline-flex items-center gap-2" onClick={() => handleLocalSort('name')}>
                            名称
                            <SortIcon active={localSortKey === 'name'} direction={localSortDirection} />
                          </button>
                        </TableHead>
                        <TableHead className="w-[240px] min-w-[240px] whitespace-nowrap">
                          <button className="inline-flex items-center gap-2" onClick={() => handleLocalSort('source')}>
                            标签 / 来源
                            <SortIcon active={localSortKey === 'source'} direction={localSortDirection} />
                          </button>
                        </TableHead>
                        <TableHead>状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {localPagination.items.map((skill) => (
                        <TableRow key={skill.name} className="cursor-pointer" onClick={() => setSelectedSkill(skill)}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedForExport.has(skill.name)}
                              onChange={() => toggleExportSelection(skill.name)}
                            />
                          </TableCell>
                          <TableCell className="w-[180px] min-w-[180px]">
                            <div className="space-y-1">
                              <div className="font-medium">{skill.name}</div>
                              <div className="text-xs text-muted-foreground line-clamp-2">{getDisplayDescription(skill)}</div>
                            </div>
                          </TableCell>
                          <TableCell className="w-[240px] min-w-[240px] max-w-[240px]">
                            <div className="flex flex-wrap gap-1.5">
                              <Badge className={`shrink-0 whitespace-nowrap ${SOURCE_COLORS[normalizeSkillSource(skill)] || DEFAULT_SOURCE_COLOR}`}>
                                {getSourceLabel(normalizeSkillSource(skill))}
                              </Badge>
                              {(skill.tags || []).slice(0, 4).map((tag) => (
                                <Badge key={tag} variant="outline" className="shrink-0 whitespace-nowrap text-xs">{tag}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {syncStatusByName[skill.name]?.aceharnessBuiltin ? (
                                <Badge variant="outline" className="text-xs border-primary/40 text-primary">内置可同步</Badge>
                              ) : null}
                              {skill.hasPromptMd ? (
                                <Badge variant="outline" className="text-xs border-green-500/40 text-green-600 dark:text-green-400">PROMPT</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {localPagination.items.map((skill) => (
                    <motion.div
                      key={skill.name}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`relative rounded-[24px] border border-border/70 bg-card/88 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(15,23,42,0.14)] cursor-pointer ${
                        selectedForExport.has(skill.name) ? 'ring-2 ring-primary' : ''
                      }`}
                      onClick={() => setSelectedSkill(skill)}
                    >
                      <div className="absolute top-3 right-3" onClick={(e) => { e.stopPropagation(); toggleExportSelection(skill.name); }}>
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer ${
                          selectedForExport.has(skill.name) ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                        }`}>
                          {selectedForExport.has(skill.name) ? <span className="text-white text-xs">✓</span> : null}
                        </div>
                      </div>
                      <div className="pr-8">
                        <h3 className="font-semibold text-sm">{skill.name}</h3>
                        <p className="mt-2 text-xs leading-6 text-muted-foreground line-clamp-3">{getDisplayDescription(skill)}</p>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        <Badge className={SOURCE_COLORS[normalizeSkillSource(skill)] || DEFAULT_SOURCE_COLOR}>
                          {getSourceLabel(normalizeSkillSource(skill))}
                        </Badge>
                        {syncStatusByName[skill.name]?.aceharnessBuiltin ? (
                          <Badge variant="outline" className="text-xs border-primary/40 text-primary">内置可同步</Badge>
                        ) : null}
                        {skill.hasPromptMd ? (
                          <Badge variant="outline" className="text-xs border-green-500/40 text-green-600 dark:text-green-400">PROMPT</Badge>
                        ) : null}
                      </div>
                      <div className="mt-4 flex min-h-12 flex-wrap gap-1.5">
                        {(skill.tags || []).slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                      <div className="mt-4 rounded-[18px] border border-border/60 bg-background/75 px-3 py-2 text-xs text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                        {formatLocalUpdatedAt(skill.updatedAt)}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>

            {localPagination.total > 0 ? (
              <Pagination
                current={localPagination.page}
                total={localPagination.total}
                pageSize={localPagination.pageSize}
                onChange={setLocalPage}
              />
            ) : null}

            {selectedSkill ? (
              <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedSkill(null)}>
                <div className="bg-card rounded-lg border w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                  <div className="p-6 border-b flex items-center justify-between flex-shrink-0">
                    <div>
                      <h2 className="text-xl font-semibold">{selectedSkill.name}</h2>
                      <div className="flex gap-2 mt-1">
                        <Badge className={SOURCE_COLORS[normalizeSkillSource(selectedSkill)] || DEFAULT_SOURCE_COLOR}>
                          {getSourceLabel(normalizeSkillSource(selectedSkill))}
                        </Badge>
                        {selectedSkill.hasPromptMd ? (
                          <Badge variant="outline" className="border-green-500/40 text-green-600 dark:text-green-400">PROMPT.md</Badge>
                        ) : null}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedSkill(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex-1 overflow-auto p-6 space-y-6">
                    <div>
                      <p className="text-sm text-muted-foreground">{getDisplayDescription(selectedSkill)}</p>
                    </div>
                    {selectedSkill.tags?.length ? (
                      <div>
                        <h4 className="text-sm font-medium mb-2">标签</h4>
                        <div className="flex flex-wrap gap-2">
                          {selectedSkill.tags.map((tag) => (
                            <span key={tag} className="text-xs px-3 py-1 bg-secondary rounded-full">{tag}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {selectedSkill.detailedDescription ? (
                      <div>
                        <h4 className="text-sm font-medium mb-2">详细说明</h4>
                        <div className="p-4 bg-muted rounded-lg text-sm">
                          <Markdown>{selectedSkill.detailedDescription}</Markdown>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <section className="sticky top-[4.5rem] z-20 rounded-[28px] border border-border/70 bg-card/90 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur supports-[backdrop-filter]:bg-card/80">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-1 flex-col gap-3">
                  <SkillSearch
                    onSearch={setSearchKeyword}
                    onCategoryChange={setSelectedCategory}
                    categories={categories}
                  />
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{onlineSummaryLabel}</span>
                  <Select value={String(onlinePageSize)} onValueChange={(value) => setOnlinePageSize(Number(value))}>
                    <SelectTrigger className="h-9 w-[112px] bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option} / 页
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
                    <Button
                      size="sm"
                      variant={onlineViewMode === 'gallery' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => setOnlineViewMode('gallery')}
                    >
                      <span className="material-symbols-outlined text-sm">grid_view</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={onlineViewMode === 'table' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => setOnlineViewMode('table')}
                    >
                      <span className="material-symbols-outlined text-sm">table_rows</span>
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-border/70 bg-card/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur">
              {onlineError ? (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                  {onlineError}
                </div>
              ) : onlineLoading ? (
                <div className="flex justify-center items-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
                </div>
              ) : sortedOnlineSkills.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {searchKeyword ? '没有找到匹配的 skill' : '暂无 skill'}
                </div>
              ) : onlineViewMode === 'table' ? (
                <div className="overflow-hidden rounded-[24px] border border-border/70 bg-background/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[148px] min-w-[148px]">名称</TableHead>
                        <TableHead className="w-[116px] min-w-[116px]">组织</TableHead>
                        <TableHead className="w-[108px] min-w-[108px]">作者</TableHead>
                        <TableHead className="w-[84px] min-w-[84px]">下载量</TableHead>
                        <TableHead className="w-[72px] min-w-[72px]">评分</TableHead>
                        <TableHead className="w-[108px] min-w-[108px]">更新时间</TableHead>
                        <TableHead className="w-[148px] min-w-[148px]">标签</TableHead>
                        <TableHead className="w-[168px] min-w-[168px] text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedOnlineSkills.map((skill) => {
                        const installName = skill.enName || skill.name;
                        return (
                          <TableRow key={skill.id}>
                            <TableCell className="w-[148px] min-w-[148px] max-w-[148px]">
                              <div className="space-y-1">
                                <div className="truncate font-medium">{skill.enName || skill.name}</div>
                                {skill.enName && skill.name !== skill.enName ? (
                                  <div className="truncate text-xs text-muted-foreground">{skill.name}</div>
                                ) : null}
                                <div className="text-xs text-muted-foreground line-clamp-2">{skill.description}</div>
                              </div>
                            </TableCell>
                            <TableCell className="w-[116px] min-w-[116px] max-w-[116px] truncate">{skill.organization || '-'}</TableCell>
                            <TableCell className="w-[108px] min-w-[108px] max-w-[108px] truncate">{skill.author}</TableCell>
                            <TableCell>{skill.downloads}</TableCell>
                            <TableCell>{skill.overallScore || '-'}</TableCell>
                            <TableCell>{formatOnlineUpdatedAt(skill.updatedAt)}</TableCell>
                            <TableCell className="w-[148px] min-w-[148px] max-w-[148px]">
                              <div className="flex gap-1 overflow-hidden whitespace-nowrap">
                                {skill.tags.slice(0, 4).map((tag) => (
                                  <Badge key={tag} variant="outline" className="shrink-0 text-xs">{tag}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="w-[168px] min-w-[168px] text-right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => setSelectedOnlineSkill(skill)}>
                                  详情
                                </Button>
                                {skill.installed ? (
                                  <>
                                    <Button size="sm" variant="secondary" disabled>
                                      已安装
                                    </Button>
                                    <Button size="sm" onClick={() => handleInstall(installName)}>
                                      重新安装
                                    </Button>
                                  </>
                                ) : (
                                  <Button size="sm" onClick={() => handleInstall(installName)}>
                                    安装
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sortedOnlineSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onInstall={handleInstall}
                      onViewDetail={setSelectedOnlineSkill}
                    />
                  ))}
                </div>
              )}
            </section>

            {totalItems > 0 ? (
              <Pagination
                current={onlinePage}
                total={totalItems}
                pageSize={onlinePageSize}
                onChange={setOnlinePage}
              />
            ) : null}

            {installing ? (
              <InstallProgress
                progress={installProgress}
                onClose={() => setInstalling(null)}
              />
            ) : null}

            {selectedOnlineSkill ? (
              <SkillDetail
                skill={selectedOnlineSkill}
                onClose={() => setSelectedOnlineSkill(null)}
                onInstall={handleInstall}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
