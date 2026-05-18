'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SkillSearchProps {
  onSearch: (keyword: string) => void;
  onCategoryChange: (category: string) => void;
  categories: Array<{ id: string; enName: string; cnName: string; count: number }>;
}

export function SkillSearch({ onSearch, onCategoryChange, categories }: SkillSearchProps) {
  const [keyword, setKeyword] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const handleSearch = () => {
    onSearch(keyword);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleCategoryClick = (categoryId: string) => {
    setSelectedCategory(categoryId);
    onCategoryChange(categoryId);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row">
        <Input
          type="text"
          placeholder="搜索 skill..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyPress={handleKeyPress}
          className="h-11 flex-1 rounded-2xl border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        />
        <Button onClick={handleSearch} className="h-11 rounded-2xl px-5">
          <Search className="mr-2 h-4 w-4" />
          搜索
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => handleCategoryClick('')}
          variant={selectedCategory === '' ? 'default' : 'outline'}
          size="sm"
          className="rounded-full"
        >
          全部
        </Button>

        {categories.slice(0, 10).map(category => (
          <Button
            key={category.id}
            onClick={() => handleCategoryClick(category.id)}
            variant={selectedCategory === category.id ? 'default' : 'outline'}
            size="sm"
            className="rounded-full"
          >
            {category.cnName} ({category.count})
          </Button>
        ))}
      </div>
    </div>
  );
}
