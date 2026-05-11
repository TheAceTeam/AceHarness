'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, FolderOpen, Puzzle, Store, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

const SOURCE_COLORS: Record<string, string> = {
  'ace-custom': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  anthropics: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};
const DEFAULT_SOURCE_COLOR = 'bg-slate-500/20 text-slate-300 border-slate-500/30';
const SOURCE_LABELS: Record<string, string> = {
  'ace-custom': 'ACE 自定义',
  anthropics: 'Anthropics',
};
const SOURCE_ICONS: Record<string, string> = {
  'ace-custom': '🧩',
  anthropics: '✨',
};
const SOURCE_ORDER = ['ace-custom', 'anthropics'];

function normalizeSkillSource(skill: Pick<LocalSkill, 'source'>): string {
  return skill.source?.trim() === 'anthropics' ? 'anthropics' : 'ace-custom';
}

function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source;
}

function getSourceIcon(source: string): string {
  return SOURCE_ICONS[source] || '🧩';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [onlineSkills, setOnlineSkills] = useState<MarketplaceSkill[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
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
            pageNum: currentPage,
            pageSize: DEFAULT_PAGE_SIZE,
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
  }, [activeTab, searchKeyword, selectedCategory, currentPage]);

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
          prev.map((skill) => (skill.name === skillName ? { ...skill, installed: true } : skill)),
        );
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

  const sourceFilterOptions = useMemo(() => ['all', ...sourceKeys], [sourceKeys]);
  const installSkillPathSet = useMemo(() => new Set(installSkills.map((skill) => skill.path)), [installSkills]);

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

  const filteredSkills = useMemo(() => {
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

  const groupedSkills = useMemo(() => {
    const groups = filteredSkills.reduce<Record<string, LocalSkill[]>>((acc, skill) => {
      const source = normalizeSkillSource(skill);
      acc[source] = acc[source] || [];
      acc[source].push(skill);
      return acc;
    }, {});
    return sourceKeys.filter((source) => groups[source]?.length).map((source) => [source, groups[source]] as const);
  }, [filteredSkills, sourceKeys]);

  const getDisplayDescription = (skill: LocalSkill) => skill.descriptionZh || skill.description;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="h-14 border-b bg-card flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回首页
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">Skills 管理</h1>
        </div>
        <div className="flex items-center gap-2">
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
                {uploading ? '导入中...' : '上传 Skill (ZIP)'}
              </Button>
              <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting || selectedForExport.size === 0}>
                <Download className={`w-4 h-4 mr-1 ${exporting ? 'animate-bounce' : ''}`} />
                {exporting ? '导出中...' : `导出选中 (${selectedForExport.size})`}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeSkillsDir}>
                <FolderOpen className="w-4 h-4 mr-1" />
                打开工作目录
              </Button>
            </>
          ) : null}
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>

      <div className="border-b bg-card">
        <div className="flex gap-1 px-6 py-2">
          <Button size="sm" variant={activeTab === 'local' ? 'default' : 'ghost'} onClick={() => setActiveTab('local')} className="gap-2">
            <Puzzle className="w-4 h-4" />
            本地管理
          </Button>
          <Button size="sm" variant={activeTab === 'online' ? 'default' : 'ghost'} onClick={() => setActiveTab('online')} className="gap-2">
            <Store className="w-4 h-4" />
            Skill 广场
          </Button>
        </div>
      </div>

      {activeTab === 'local' ? (
        <>
          <div className="border-b bg-card p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Input
                placeholder="搜索 Skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64"
              />
              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground">来源:</span>
                {sourceFilterOptions.map((src) => (
                  <Button
                    key={src}
                    size="sm"
                    variant={selectedSource === src ? 'default' : 'outline'}
                    onClick={() => setSelectedSource(src)}
                  >
                    {src === 'all' ? `全部 (${skills.length})` : `${getSourceLabel(src)} (${sourceCounts[src] || 0})`}
                  </Button>
                ))}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleSyncBuiltinAceharnessSkills}
                disabled={syncingAllBuiltin || builtinAceharnessInstallCount === 0}
              >
                {syncingAllBuiltin ? '同步中...' : `同步内置 aceharness Skills (${builtinAceharnessInstallCount})`}
              </Button>
            </div>
            {(runtimeSkillsDir || installSkillsDir) && (
              <div className="mt-3 text-xs text-muted-foreground space-y-1">
                {runtimeSkillsDir ? <div>Runtime 目录: {runtimeSkillsDir}</div> : null}
                {installSkillsDir ? <div>安装目录: {installSkillsDir}</div> : null}
              </div>
            )}
            {allTags.length > 0 ? (
              <div className="flex gap-2 items-center mt-3 flex-wrap">
                <span className="text-sm text-muted-foreground shrink-0">标签:</span>
                <div className="flex flex-wrap gap-1">
                  {allTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]))}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {runtimeSkillsDir ? (
            <WorkspaceEditor
              open={workspaceOpen}
              onOpenChange={setWorkspaceOpen}
              workspacePath={runtimeSkillsDir}
              title="Runtime Skills"
            />
          ) : null}

          <div className="flex-1 overflow-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-muted-foreground">加载中...</div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-64">
                <p className="text-destructive mb-4">{error}</p>
                <Button onClick={() => void loadSkills()}>重试</Button>
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Puzzle className="w-12 h-12 mb-4" />
                <p>{searchQuery ? '没有匹配的 Skills' : '暂无 Skills'}</p>
              </div>
            ) : (
              <div className="space-y-8">
                {groupedSkills.map(([source, sourceSkills]) => (
                  <div key={source}>
                    <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <span>{getSourceIcon(source)}</span>
                      {getSourceLabel(source)}
                      <Badge variant="secondary">{sourceSkills.length}</Badge>
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {sourceSkills.map((skill) => (
                        <motion.div
                          key={skill.name}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`bg-card border rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer relative ${
                            selectedForExport.has(skill.name) ? 'ring-2 ring-primary' : ''
                          }`}
                          onClick={() => setSelectedSkill(skill)}
                        >
                          <div className="absolute top-2 right-2" onClick={(e) => { e.stopPropagation(); toggleExportSelection(skill.name); }}>
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer ${
                              selectedForExport.has(skill.name) ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                            }`}>
                              {selectedForExport.has(skill.name) ? <span className="text-white text-xs">✓</span> : null}
                            </div>
                          </div>
                          <div className="flex items-start gap-2 mb-2 pr-6">
                            <h3 className="font-semibold text-sm">{skill.name}</h3>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                            {getDisplayDescription(skill)}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {syncStatusByName[skill.name]?.aceharnessBuiltin ? (
                              <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                                内置可同步
                              </Badge>
                            ) : null}
                            {skill.hasPromptMd ? (
                              <Badge variant="default" className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
                                PROMPT
                              </Badge>
                            ) : null}
                            {skill.tags?.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                            ))}
                            {(skill.tags?.length || 0) > 3 ? (
                              <Badge variant="outline" className="text-xs">+{skill.tags!.length - 3}</Badge>
                            ) : null}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                        <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">
                          PROMPT.md
                        </Badge>
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
        <div className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Store className="w-5 h-5" />
                Skill 广场
              </h2>
              <p className="text-sm text-muted-foreground mt-1">从 OpenHarmony 官方广场搜索并安装 skill</p>
            </div>

            <SkillSearch
              onSearch={(keyword) => {
                setSearchKeyword(keyword);
                setCurrentPage(1);
              }}
              onCategoryChange={(category) => {
                setSelectedCategory(category);
                setCurrentPage(1);
              }}
              categories={categories}
            />

            {onlineError ? (
              <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                {onlineError}
              </div>
            ) : null}

            {onlineLoading ? (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
              </div>
            ) : onlineSkills.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {onlineSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    onInstall={handleInstall}
                    onViewDetail={setSelectedOnlineSkill}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                {searchKeyword ? '没有找到匹配的 skill' : '暂无 skill'}
              </div>
            )}

            {totalItems > 0 ? (
              <Pagination
                current={currentPage}
                total={totalItems}
                pageSize={DEFAULT_PAGE_SIZE}
                onChange={setCurrentPage}
              />
            ) : null}
          </div>

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
        </div>
      )}
    </div>
  );
}
