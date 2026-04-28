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
import { Search, ArrowLeft, FileText, Tag, Calendar, User, Upload, Download, Puzzle, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import Markdown from '@/components/Markdown';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface Skill {
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
const DEFAULT_SOURCE_COLOR = 'bg-slate-500/20 text-slate-300 border-slate-500/30';
const SOURCE_LABELS: Record<string, string> = { cangjie: 'Cangjie', anthropics: 'Anthropics' };
const SOURCE_ICONS: Record<string, string> = { cangjie: '🔧', anthropics: '✨' };
const SOURCE_ORDER = ['cangjie', 'anthropics'];

function normalizeSkillSource(skill: Pick<Skill, 'source'>): string {
  return skill.source?.trim() || 'cangjie';
}

function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source;
}

function getSourceIcon(source: string): string {
  return SOURCE_ICONS[source] || '🧩';
}

export default function SkillsPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const { toast } = useToast();
  useDocumentTitle('Skills 管理');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSkills();
  }, []);

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
      }
    } catch (err) {
      setError('加载 skills 失败');
    } finally {
      setLoading(false);
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
        await loadSkills();
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

  // PLACEHOLDER_REST

  // Get all unique tags
  const allTags = useMemo(() =>
    Array.from(new Set(skills.flatMap(s => s.tags || []))).sort(),
    [skills]
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

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  // Filter skills
  const filteredSkills = useMemo(() => {
    return skills.filter(skill => {
      if (selectedSource !== 'all' && normalizeSkillSource(skill) !== selectedSource) return false;
      if (selectedTags.length > 0 && !selectedTags.some(tag => skill.tags?.includes(tag))) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          skill.name.toLowerCase().includes(q) ||
          skill.description.toLowerCase().includes(q) ||
          (skill.descriptionZh || '').toLowerCase().includes(q) ||
          skill.tags?.some(tag => tag.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [skills, selectedSource, selectedTags, searchQuery]);

  const groupedSkills = useMemo(() => {
    const groups = filteredSkills.reduce<Record<string, Skill[]>>((acc, skill) => {
      const source = normalizeSkillSource(skill);
      acc[source] = acc[source] || [];
      acc[source].push(skill);
      return acc;
    }, {});
    return sourceKeys
      .filter(source => groups[source]?.length)
      .map(source => [source, groups[source]] as const);
  }, [filteredSkills, sourceKeys]);

  const getDisplayDescription = (skill: Skill) => {
    return skill.descriptionZh || skill.description;
  };

  // PLACEHOLDER_RENDER

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
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
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>

      {/* Filters */}
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
            {sourceFilterOptions.map(src => (
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
        </div>
        {allTags.length > 0 && (
          <div className="flex gap-2 items-center mt-3 flex-wrap">
            <span className="text-sm text-muted-foreground shrink-0">标签:</span>
            <div className="flex flex-wrap gap-1">
              {allTags.map(tag => (
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

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">加载中...</div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={loadSkills}>重试</Button>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Puzzle className="w-12 h-12 mb-4" />
            <p>{searchQuery ? '没有匹配的 Skills' : '暂无 Skills'}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groupedSkills.map(([source, sourceSkills]) =>
              sourceSkills.length > 0 && (
                <div key={source}>
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <span>{getSourceIcon(source)}</span>
                    {getSourceLabel(source)}
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
                        onClick={() => setSelectedSkill(skill)}
                      >
                        {/* Export checkbox */}
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

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedSkill(null)}>
          <div
            className="bg-card rounded-lg border w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-xl font-semibold">{selectedSkill.name}</h2>
                <div className="flex gap-2 mt-1">
                  <Badge className={SOURCE_COLORS[normalizeSkillSource(selectedSkill)] || DEFAULT_SOURCE_COLOR}>
                    {normalizeSkillSource(selectedSkill)}
                  </Badge>
                  {selectedSkill.hasPromptMd && (
                    <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30">
                      PROMPT.md
                    </Badge>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedSkill(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Description */}
              <div>
                <p className="text-sm text-muted-foreground">{getDisplayDescription(selectedSkill)}</p>
              </div>

              {/* Tags */}
              {selectedSkill.tags && selectedSkill.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <Tag className="w-4 h-4" />
                    标签
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedSkill.tags.map((tag) => (
                      <span key={tag} className="text-xs px-3 py-1 bg-secondary rounded-full">{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Detailed description */}
              {selectedSkill.detailedDescription && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <FileText className="w-4 h-4" />
                    详细说明
                  </h4>
                  <div className="p-4 bg-muted rounded-lg text-sm">
                    <Markdown>{selectedSkill.detailedDescription}</Markdown>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
