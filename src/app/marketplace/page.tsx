'use client';

import { useState, useEffect } from 'react';
import {
  SkillCard,
  SkillSearch,
  InstallProgress,
  SkillDetail,
} from '@/components/marketplace';
import { PaginationBar } from '@/components/PaginationBar';
import { MarketplaceSkill, InstallProgress as InstallProgressType } from '@/types/marketplace';
import { DEFAULT_PAGE_SIZE } from '@/constants/marketplace';

const PAGE_SIZE_OPTIONS = [15, 30, 60, 100];

export default function MarketplacePage() {
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalItems, setTotalItems] = useState(0);

  const [installing, setInstalling] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgressType>({
    skillName: '',
    status: 'downloading',
    progress: 0,
    message: '',
  });

  const [selectedSkill, setSelectedSkill] = useState<MarketplaceSkill | null>(null);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const fetchSkills = async () => {
      try {
        const response = await fetch('/api/marketplace/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: searchKeyword,
            category: selectedCategory,
            pageNum: currentPage,
            pageSize,
          }),
        });

        const data = await response.json();

        if (data.success) {
          setSkills(data.data.skills);
          setTotalItems(data.data.total);
        } else {
          setError(data.error || 'Failed to load skills');
        }
      } catch (error) {
        setError('Network error');
        console.error('Failed to load skills:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSkills();
  }, [searchKeyword, selectedCategory, currentPage, pageSize]);

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

  const handleInstall = async (skillName: string) => {
    setSelectedSkill(null);
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

        setSkills(prev =>
          prev.map(skill =>
            skill.name === skillName ? { ...skill, installed: true } : skill
          )
        );
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

  const closeSkillDetail = () => {
    setSelectedSkill(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Skill 广场</h1>
          <p className="text-muted-foreground mt-2">
            从 OpenHarmony 官方 Skill 广场搜索并安装 skill
          </p>
        </div>

        <SkillSearch
          onSearch={handleSearch}
          onCategoryChange={handleCategoryChange}
          categories={categories}
        />

        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          </div>
        ) : skills.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {skills.map(skill => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onInstall={handleInstall}
                onViewDetail={setSelectedSkill}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            {searchKeyword ? '没有找到匹配的 skill' : '暂无 skill'}
          </div>
        )}

        {totalItems > 0 && (
          <PaginationBar
            current={currentPage}
            total={totalItems}
            pageSize={pageSize}
            onPageChange={handlePageChange}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
            itemLabel="Skill"
          />
        )}
      </div>

      {installing && (
        <InstallProgress
          progress={installProgress}
          onClose={closeInstallProgress}
        />
      )}

      {selectedSkill && (
        <SkillDetail
          skill={selectedSkill}
          onClose={closeSkillDetail}
          onInstall={handleInstall}
        />
      )}
    </div>
  );
}
