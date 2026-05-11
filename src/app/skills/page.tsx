'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { Search, ArrowLeft, FileText, Tag, Calendar, User, Upload, Download, Puzzle, X, CloudDownload, Store } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import Markdown from '@/components/Markdown';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  SkillCard,
  SkillSearch,
  InstallProgress,
  SkillDetail,
  Pagination
} from '@/components/marketplace';
import { MarketplaceSkill, InstallProgress as InstallProgressType } from '@/types/marketplace';
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

const SOURCE_COLORS: Record<string, string> = {
  cangjie: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  anthropics: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

type TabType = 'local' | 'online';

export default function SkillsPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const { toast } = useToast();
  useDocumentTitle('Skills 管理');

  const [activeTab, setActiveTab] = useState<TabType>('local');

  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [selectedLocalSkill, setSelectedLocalSkill] = useState<LocalSkill | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
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
      loadLocalSkills();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'online') {
      loadCategories();
    }
  }, [activeTab]);

  const loadLocalSkills = async () => {
    try {
      setLocalLoading(true);
      setLocalError(null);
      const response = await fetch('/api/skills');
      const data = await response.json();
      if (data.error) {
        setLocalError(data.error);
      } else {
        setLocalSkills(data.skills || []);
      }
    } catch (err) {
      setLocalError('加载 skills 失败');
    } finally {
      setLocalLoading(false);
    }
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
        await loadLocalSkills();
      } else {
        toast('error', data.error || '导入失败');
      }
    } catch (err) {
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
    } catch (err) {
      toast('error', '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const toggleExportSelection = (name: string) => {
    setSelectedForExport(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const loadCategories = async () => {
    try {
      const response = await fetch('/api/marketplace/categories');
      const data = await response.json();

      if (data.success) {
        setCategories(data.data.categories);
      }
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  };

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
          setOnlineSkills(data.data.skills);
          setTotalItems(data.data.total);
        } else {
          setOnlineError(data.error || 'Failed to load skills');
        }
      } catch (error) {
        setOnlineError('Network error');
        console.error('Failed to load skills:', error);
      } finally {
        setOnlineLoading(false);
      }
    };

    fetchSkills();
  }, [activeTab, searchKeyword, selectedCategory, currentPage]);

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
      setInstallProgress(prev => ({
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

        setOnlineSkills(prev =>
          prev.map(skill =>
            skill.name === skillName ? { ...skill, installed: true } : skill
          )
        );
        
        toast('success', `Skill "${skillName}" 已成功安装`);
        
        if (activeTab === 'local') {
          loadLocalSkills();
        }
      } else {
        setInstallProgress({
          skillName,
          status: 'error',
          progress: 100,
          message: data.error || '安装失败',
        });
      }
    } catch (error) {
      setInstallProgress({
        skillName,
        status: 'error',
        progress: 100,
        message: '网络错误',
      });
    }
  };

  const handleSearch = (keyword: string) => {
    setSearchKeyword(keyword);
    setCurrentPage(1);
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const closeInstallProgress = () => {
    setInstalling(null);
  };

  const allLocalTags = useMemo(() =>
    Array.from(new Set(localSkills.flatMap(s => s.tags || []))).sort(),
    [localSkills]
  );

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const filteredLocalSkills = useMemo(() => {
    return localSkills.filter(skill => {
      if (selectedSource !== 'all' && (skill.source || 'cangjie') !== selectedSource) return false;
      if (selectedTags.length > 0 && !selectedTags.some(tag => skill.tags?.includes(tag))) return false;
      if (localSearchQuery) {
        const q = localSearchQuery.toLowerCase();
        return (
          skill.name.toLowerCase().includes(q) ||
          skill.description.toLowerCase().includes(q) ||
          (skill.descriptionZh || '').toLowerCase().includes(q) ||
          skill.tags?.some(tag => tag.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [localSkills, selectedSource, selectedTags, localSearchQuery]);

  const groupedLocalSkills = useMemo(() => ({
    cangjie: filteredLocalSkills.filter(s => (s.source || 'cangjie') === 'cangjie'),
    anthropics: filteredLocalSkills.filter(s => s.source === 'anthropics'),
  }), [filteredLocalSkills]);

  const sourceLabels: Record<string, string> = { cangjie: 'Cangjie', anthropics: 'Anthropics' };
  const sourceIcons: Record<string, string> = { cangjie: '🔧', anthropics: '✨' };

  const getDisplayDescription = (skill: LocalSkill) => {
    return skill.descriptionZh || skill.description;
  };

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
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>

      <div className="border-b bg-card">
        <div className="flex gap-1 px-6 py-2">
          <Button
            size="sm"
            variant={activeTab === 'local' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('local')}
            className="gap-2"
          >
            <Puzzle className="w-4 h-4" />
            本地管理
          </Button>
          <Button
            size="sm"
            variant={activeTab === 'online' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('online')}
            className="gap-2"
          >
            <Store className="w-4 h-4" />
            在线安装
          </Button>
        </div>
      </div>

      {activeTab === 'local' && (
        <>
          <div className="border-b bg-card p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleUploadZip}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className={`w-4 h-4 mr-1 ${uploading ? 'animate-bounce' : ''}`} />
                {uploading ? '导入中...' : '上传 Skill (ZIP)'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                disabled={exporting || selectedForExport.size === 0}
              >
                <Download className={`w-4 h-4 mr-1 ${exporting ? 'animate-bounce' : ''}`} />
                {exporting ? '导出中...' : `导出选中 (${selectedForExport.size})`}
              </Button>
              <Input
                placeholder="搜索本地 Skills..."
                value={localSearchQuery}
                onChange={(e) => setLocalSearchQuery(e.target.value)}
                className="w-64"
              />
              <div className="flex gap-2 items-center">
                <span className="text-sm text-muted-foreground">来源:</span>
                {(['all', 'cangjie', 'anthropics'] as const).map(src => (
                  <Button
                    key={src}
                    size="sm"
                    variant={selectedSource === src ? 'default' : 'outline'}
                    onClick={() => setSelectedSource(src)}
                  >
                    {src === 'all' ? `全部 (${localSkills.length})` : `${sourceLabels[src]} (${localSkills.filter(s => (s.source || 'cangjie') === src).length})`}
                  </Button>
                ))}
              </div>
            </div>
            {allLocalTags.length > 0 && (
              <div className="flex gap-2 items-center mt-3 flex-wrap">
                <span className="text-sm text-muted-foreground shrink-0">标签:</span>
                <div className="flex flex-wrap gap-1">
                  {allLocalTags.map(tag => (
                    <Badge
                      key={tag}
                      variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto p-6">
            {localLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-muted-foreground">加载中...</div>
              </div>
            ) : localError ? (
              <div className="flex flex-col items-center justify-center h-64">
                <p className="text-destructive mb-4">{localError}</p>
                <Button onClick={loadLocalSkills}>重试</Button>
              </div>
            ) : filteredLocalSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Puzzle className="w-12 h-12 mb-4" />
                <p>{localSearchQuery ? '没有匹配的 Skills' : '暂无本地 Skills'}</p>
                <p className="text-sm mt-2">点击"在线安装"从官方广场安装 Skills</p>
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(groupedLocalSkills).map(([source, sourceSkills]) =>
                  sourceSkills.length > 0 && (
                    <div key={source}>
                      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <span>{sourceIcons[source]}</span>
                        {sourceLabels[source]}
                        <Badge variant="secondary">{sourceSkills.length}</Badge>
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {sourceSkills.map(skill => (
                          <motion.div
                            key={skill.name}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`bg-card border rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer relative ${
                              selectedForExport.has(skill.name) ? 'ring-2 ring-primary' : ''
                            }`}
                            onClick={() => setSelectedLocalSkill(skill)}
                          >
                            <div
                              className="absolute top-2 right-2"
                              onClick={(e) => { e.stopPropagation(); toggleExportSelection(skill.name); }}
                            >
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer ${
                                selectedForExport.has(skill.name) ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                              }`}>
                                {selectedForExport.has(skill.name) && <span className="text-white text-xs">✓</span>}
                              </div>
                            </div>

                            <div className="flex items-start gap-2 mb-2 pr-6">
                              <h3 className="font-semibold text-sm">{skill.name}</h3>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                              {getDisplayDescription(skill)}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {skill.hasPromptMd && (
                                <Badge variant="default" className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
                                  PROMPT
                                </Badge>
                              )}
                              {skill.tags?.slice(0, 3).map(tag => (
                                <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                              ))}
                              {(skill.tags?.length || 0) > 3 && (
                                <Badge variant="outline" className="text-xs">+{skill.tags!.length - 3}</Badge>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {selectedLocalSkill && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedLocalSkill(null)}>
              <div
                className="bg-card rounded-lg border w-full max-w-3xl max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6 border-b flex items-center justify-between flex-shrink-0">
                  <div>
                    <h2 className="text-xl font-semibold">{selectedLocalSkill.name}</h2>
                    <div className="flex gap-2 mt-1">
                      <Badge className={SOURCE_COLORS[selectedLocalSkill.source || 'cangjie']}>
                        {selectedLocalSkill.source || 'cangjie'}
                      </Badge>
                      {selectedLocalSkill.hasPromptMd && (
                        <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">
                          PROMPT.md
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setSelectedLocalSkill(null)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-auto p-6 space-y-6">
                  <div>
                    <p className="text-sm text-muted-foreground">{getDisplayDescription(selectedLocalSkill)}</p>
                  </div>

                  {selectedLocalSkill.tags && selectedLocalSkill.tags.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                        <Tag className="w-4 h-4" />
                        标签
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedLocalSkill.tags.map((tag) => (
                          <span key={tag} className="text-xs px-3 py-1 bg-secondary rounded-full">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedLocalSkill.detailedDescription && (
                    <div>
                      <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                        <FileText className="w-4 h-4" />
                        详细说明
                      </h4>
                      <div className="p-4 bg-muted rounded-lg text-sm">
                        <Markdown>{selectedLocalSkill.detailedDescription}</Markdown>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'online' && (
        <>
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Store className="w-5 h-5" />
                Skill 广场
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                从 OpenHarmony 官方广场搜索并安装 skill
              </p>
            </div>

            <SkillSearch
              onSearch={handleSearch}
              onCategoryChange={handleCategoryChange}
              categories={categories}
            />

            {onlineError && (
              <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                {onlineError}
              </div>
            )}

            {onlineLoading ? (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
              </div>
            ) : onlineSkills.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {onlineSkills.map(skill => (
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

            {totalItems > 0 && (
              <Pagination
                current={currentPage}
                total={totalItems}
                pageSize={DEFAULT_PAGE_SIZE}
                onChange={handlePageChange}
              />
            )}
          </div>

          {selectedOnlineSkill && (
            <SkillDetail
              skill={selectedOnlineSkill}
              onClose={() => setSelectedOnlineSkill(null)}
              onInstall={handleInstall}
            />
          )}
        </>
      )}

      {installing && (
        <InstallProgress
          progress={installProgress}
          onClose={closeInstallProgress}
        />
      )}
    </div>
  );
}